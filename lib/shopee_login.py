import json
import sys


def session_for_payments(data):
    def merchant(m):
        return {**{k: m[k] for k in ("id", "name", "status")},
                "staffUserId": m["staff_user_id"], "staffRole": m["staff_role"],
                "staffStatus": m["staff_status"], "isActive": m["is_active"],
                "isBanned": m["is_banned"], "isCurrentLoginUser": m["is_current_login_user"]}
    switch = data["switch_credential"]
    cookies = [{**c, "hostOnly": not c["domain"].startswith("."),
                "domain": c["domain"].lstrip(".")} for c in data["cookies"]]
    return {"version": 1, "merchant": merchant(data["merchant"]),
            "merchants": [merchant(m) for m in data["merchants"]],
            "accountId": data["account_id"], "cookies": cookies,
            "stores": data["stores"], "storeId": data.get("store_id"),
            "createdAt": data["created_at"], "expiresAt": data.get("expires_at"),
            "switchCredential": {"tocNonce": switch["toc_nonce"],
                                 "spcClientId": switch["spc_clientid"],
                                 "deviceFingerprint": switch["device_fingerprint"]}}


def handle(auth, data):
    action = data["action"]
    if action == "phone":
        return auth.request_otp(data["phone"], password=data.get("password"), channel=data.get("channel"))
    if action == "otp":
        return auth.verify_otp(data["challenge"], data["otp"])
    if action == "merchant":
        return session_for_payments(auth.complete_login(data["verification"], merchant_id=data["id"]))
    raise ValueError("Unsupported step")


if __name__ == "__main__":
    try:
        from qrismerchantid import ShopeePayPartner
        client = ShopeePayPartner(timeout=7, max_retries=0)
        try:
            result = handle(client.auth, json.load(sys.stdin))
        finally:
            client.close()
        json.dump({"result": result}, sys.stdout)
    except Exception as error:
        code = str(getattr(error, "code", "") or "").lower()
        json.dump({"error": "CAPTCHA_REQUIRED" if "captcha" in code or "captcha" in str(error).lower()
                   else "PYTHON_PROVIDER_ERROR"}, sys.stdout)
