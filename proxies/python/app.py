"""
BIRS NIN Autonomous Verifier - Python FastAPI Server-Side Proxy
Deploy on Render (Free), AWS EC2 / App Runner, Railway, or Heroku.
Bypasses browser CORS by fetching service-gateway.bsg.com.ng server-side.
"""

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
import httpx
import uvicorn
import re
import os

app = FastAPI(title="BIRS NIN Server-Side Proxy")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DEFAULT_GATEWAY = "https://service-gateway.bsg.com.ng/api/user-module/api/nin/validate"
DEFAULT_KEY = "e6385c73adba4eb6807c0ec858fd8f5c"

@app.get("/")
@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "service": "BIRS Python Proxy",
        "gateway": DEFAULT_GATEWAY,
        "message": "Live and accepting requests from your GitHub frontend"
    }

@app.post("/api/verify")
@app.post("/api/validate")
@app.post("/api/proxy")
async def verify_nin(request: Request):
    try:
        body = await request.json()
    except Exception:
        body = {}

    nin_raw = str(body.get("nin", ""))
    cleaned_nin = re.sub(r"\D", "", nin_raw)

    if len(cleaned_nin) != 11:
        return Response(
            content='{"status":"failed","message":"Invalid NIN (must be 11 digits)","details":{}}',
            status_code=400,
            media_type="application/json"
        )

    merchant_key = str(body.get("merchantKey") or DEFAULT_KEY).strip()
    target_url = str(body.get("gatewayUrl") or DEFAULT_GATEWAY)

    headers = {
        "Content-Type": "application/json",
        "X-MERCHANT-KEY": merchant_key,
        "Origin": "https://birs.be.gov.ng",
        "Referer": "https://birs.be.gov.ng/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) BIRSProxy-Python/1.0"
    }

    try:
        async with httpx.AsyncClient(timeout=25.0) as client:
            resp = await client.post(target_url, headers=headers, json={"nin": cleaned_nin})
            
            try:
                data = resp.json()
            except Exception:
                data = {"raw": resp.text}

            if resp.status_code == 200:
                return {
                    "status": "success",
                    "ok": True,
                    "message": "Verified successfully via Live BIRS Gateway",
                    "details": data,
                    "data": data
                }
            
            error_msg = data.get("message") or data.get("error") or f"Gateway returned HTTP {resp.status_code}"
            return Response(
                content=f'{{"status":"failed","ok":false,"message":"{error_msg}","details":{{}}}}',
                status_code=resp.status_code,
                media_type="application/json"
            )
    except httpx.TimeoutException:
        return Response(
            content='{"status":"failed","message":"Gateway request timed out (25s)","details":{}}',
            status_code=504,
            media_type="application/json"
        )
    except Exception as e:
        return Response(
            content=f'{{"status":"failed","message":"Network error: {str(e)}","details":{{}}}}',
            status_code=500,
            media_type="application/json"
        )

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
