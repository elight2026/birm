package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"regexp"
	"time"
)

const (
	defaultGateway = "https://service-gateway.bsg.com.ng/api/user-module/api/nin/validate"
	defaultKey     = "e6385c73adba4eb6807c0ec858fd8f5c"
)

type VerifyRequest struct {
	NIN         string `json:"nin"`
	MerchantKey string `json:"merchantKey"`
	GatewayURL  string `json:"gatewayUrl"`
}

func enableCORS(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-MERCHANT-KEY, Authorization")
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"status":"ok","service":"BIRS Go Proxy","message":"Live and accepting requests"}`))
}

func verifyHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method == http.MethodGet || r.Method == http.MethodHead {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok","service":"BIRS Go Proxy","message":"Endpoint is live. Send POST with { 'nin': '12345678901' } to verify."}`))
		return
	}

	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var reqData VerifyRequest
	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, `{"error":"Failed to read request body"}`, http.StatusBadRequest)
		return
	}
	_ = json.Unmarshal(bodyBytes, &reqData)

	re := regexp.MustCompile(`\D`)
	cleanedNIN := re.ReplaceAllString(reqData.NIN, "")

	if len(cleanedNIN) != 11 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"status":"failed","message":"Invalid NIN (must be 11 digits)","details":{}}`))
		return
	}

	targetGateway := reqData.GatewayURL
	if targetGateway == "" {
		targetGateway = defaultGateway
	}
	key := reqData.MerchantKey
	if key == "" {
		key = defaultKey
	}

	gatewayPayload, _ := json.Marshal(map[string]string{"nin": cleanedNIN})
	client := &http.Client{Timeout: 25 * time.Second}

	birsReq, err := http.NewRequest(http.MethodPost, targetGateway, bytes.NewBuffer(gatewayPayload))
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(fmt.Sprintf(`{"status":"failed","message":"Failed to create request: %s"}`, err.Error())))
		return
	}

	birsReq.Header.Set("Content-Type", "application/json")
	birsReq.Header.Set("X-MERCHANT-KEY", key)
	birsReq.Header.Set("Origin", "https://birs.be.gov.ng")
	birsReq.Header.Set("Referer", "https://birs.be.gov.ng/")
	birsReq.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) BIRSProxy-Go/1.0")

	birsResp, err := client.Do(birsReq)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusGatewayTimeout)
		w.Write([]byte(`{"status":"failed","message":"Gateway request timed out or network error"}`))
		return
	}
	defer birsResp.Body.Close()

	respBody, _ := io.ReadAll(birsResp.Body)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(birsResp.StatusCode)

	if birsResp.StatusCode == http.StatusOK {
		w.Write([]byte(fmt.Sprintf(`{"status":"success","ok":true,"message":"Verified successfully via Live BIRS Gateway","details":%s,"data":%s}`, string(respBody), string(respBody))))
	} else {
		w.Write([]byte(fmt.Sprintf(`{"status":"failed","ok":false,"message":"Gateway returned HTTP %d","details":%s}`, birsResp.StatusCode, string(respBody))))
	}
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	http.HandleFunc("/", healthHandler)
	http.HandleFunc("/api/health", healthHandler)
	http.HandleFunc("/api/verify", verifyHandler)
	http.HandleFunc("/api/validate", verifyHandler)
	http.HandleFunc("/api/proxy", verifyHandler)

	log.Printf("[BIRS Go Proxy] listening on :%s", port)
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
