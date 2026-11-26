import unittest
from unittest.mock import Mock
from lib.shopee_login import handle


class LoginAdapterTest(unittest.TestCase):
    def test_otp_and_session(self):
        auth = Mock()
        challenge = {"version": 1, "channel": 3}
        auth.request_otp.return_value = challenge
        self.assertEqual(handle(auth, {"action": "phone", "phone": "081200000000",
                                      "channel": 3, "password": "example"}), challenge)
        auth.request_otp.assert_called_once_with("081200000000", password="example", channel=3)
        auth.verify_otp.return_value = {"version": 1, "merchants": []}
        verification = handle(auth, {"action": "otp", "challenge": challenge, "otp": "000000"})
        auth.verify_otp.assert_called_once_with(challenge, "000000")
        merchant = dict(id="1", name="Demo", status=1, staff_user_id=2, staff_role=1,
                        staff_status=1, is_active=True, is_banned=False, is_current_login_user=True)
        auth.complete_login.return_value = dict(
            account_id="2", merchant=merchant, merchants=[merchant], store_id="3", created_at=1,
            stores=[{"id":"3","name":"Demo","status":1}],
            switch_credential=dict(toc_nonce="sample",spc_clientid="sample",device_fingerprint="sample"),
            cookies=[dict(name="example",value="sample",domain=".example.com",path="/",secure=True)])
        result = handle(auth, {"action": "merchant", "verification": verification, "id": "1"})
        self.assertEqual(result["merchant"]["staffUserId"], 2)
        self.assertEqual(result["storeId"], "3")
        self.assertFalse(result["cookies"][0]["hostOnly"])
        auth.complete_login.assert_called_once_with(verification, merchant_id="1")
