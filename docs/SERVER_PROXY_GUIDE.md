# BIRS NIN Gateway Server-Side Proxy (CORS Bypass Solution)

Modern web browsers enforce **Cross-Origin Resource Sharing (CORS)**. When you run a frontend from a static host like GitHub Pages (`https://<username>.github.io`), the browser prevents JavaScript from making direct cross-origin HTTP calls to `https://service-gateway.bsg.com.ng` because the gateway does not send wildcard `Access-Control-Allow-Origin: *` headers for arbitrary third-party static origins.

**The Solution:** Route requests through a **Server-Side Proxy**. Since CORS is only enforced inside web browsers, a backend server (Node.js, Python, Go, Vercel, or AWS Lambda) can freely query the BIRS gateway and return the real taxpayer details back to your GitHub frontend with full CORS support!

---

## Option 1: 1-Click Render.com Deployment (Free Tier)

Render provides free cloud hosting for Node.js, Python, and Go web services.

1. Create a free account at [render.com](https://render.com).
2. Click **New +** -> **Web Service**.
3. Connect your GitHub repository.
4. Set the Root Directory to `proxies/nodejs` (or the repository root if deploying full-stack):
   - **Environment:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Plan:** Free
5. Click **Create Web Service**.
6. Render will generate a URL like: `https://birs-proxy-abc.onrender.com`
7. In the BIRS Web App (on GitHub Pages):
   - Go to **Settings** or click **Server Proxy** in the top navigation.
   - Enter your Render URL: `https://birs-proxy-abc.onrender.com`
   - Click **Test & Connect Proxy**.
   - Done! All bulk verifications and single lookups will now route through your Render proxy with 0% CORS errors.

---

## Option 2: Vercel Serverless Function (Zero Maintenance)

This repository includes a native Vercel serverless function in `api/verify.ts` and `vercel.json`.

1. Go to [vercel.com](https://vercel.com) and click **Add New Project**.
2. Select your GitHub repository.
3. Deploy without changing settings.
4. Your proxy endpoint will be: `https://your-project.vercel.app/api/verify`
5. Paste `https://your-project.vercel.app` into the **Server Proxy** field in the BIRS web app.

---

## Option 3: Standalone Python Proxy (FastAPI)

Located in `proxies/python/`:
```bash
cd proxies/python
pip install -r requirements.txt
python app.py
```
Starts on `http://0.0.0.0:8000`. You can deploy this to Render, Railway, AWS EC2, or PythonAnywhere.

---

## Option 4: Standalone Go (Golang) Proxy

Located in `proxies/go/`:
- Zero external dependencies (uses standard library `net/http`).
- Compiles to a single lightweight binary (~10MB) that runs with minimal RAM usage.
```bash
cd proxies/go
go run main.go
```
Starts on `http://localhost:8080`.

---

## Option 5: AWS Lambda / API Gateway

Located in `proxies/aws-lambda/index.mjs`:
- Create an AWS Lambda function with Node.js 20.x runtime.
- Paste `index.mjs`.
- Enable **Function URL** with Auth type: `NONE` and check **Configure cross-origin resource sharing (CORS)**.
- Use the generated Lambda Function URL as your proxy endpoint!

---

## Verification & Status Testing

The BIRS web app includes an interactive **Proxy Connection & Latency Tester**:
- Performs an automated handshake check.
- Measures latency in milliseconds.
- Confirms CORS header availability.
- Once connected, both single NIN queries and bulk autonomous bot batches route through the server proxy automatically.
