import unittest
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime, timezone, timedelta
from models.pending_ingestion import PendingIngestion, AiParsedData
from models.phone_hook import PhoneHookMessage
from services.email_processing_service import EmailProcessingService
from services.finance_api_service import FinanceApiService

class TestShopeeMultiOrderFlow(unittest.IsolatedAsyncioTestCase):
    @patch("services.ingestion_service.PreprocessingService")
    def setUp(self, mock_prep_cls):
        self.mock_repo = AsyncMock()
        self.mock_embedding_service = AsyncMock()
        self.mock_vector_service = AsyncMock()
        self.mock_ai_service = AsyncMock()
        self.mock_finance_api = AsyncMock()

        self.service = EmailProcessingService(
            ingestion_repo=self.mock_repo,
            embedding_service=self.mock_embedding_service,
            vector_service=self.mock_vector_service,
            ai_service=self.mock_ai_service,
            finance_api_service=self.mock_finance_api
        )

    def test_is_shopee_email(self):
        shopee_hook = PhoneHookMessage(
            id="hook-shopee",
            user_id="user-1",
            raw_msg="[EMAIL]: Shopee payment confirmation",
            raw_payload={"sender": "info@shopee.ph", "subject": "Order Confirmation", "markdown_content": "Thank you for your order"},
            action="email_received",
            status="received",
            month_key="2026-08-01",
            partition_key="2026-08-01"
        )
        non_shopee_hook = PhoneHookMessage(
            id="hook-bank",
            user_id="user-1",
            raw_msg="[EMAIL]: Bank statement",
            raw_payload={"sender": "alerts@bpi.com.ph", "subject": "BPI Statement", "markdown_content": "Statement of account"},
            action="email_received",
            status="received",
            month_key="2026-08-01",
            partition_key="2026-08-01"
        )

        self.assertTrue(self.service._is_shopee_email(shopee_hook))
        self.assertFalse(self.service._is_shopee_email(non_shopee_hook))

    async def test_resolve_source_account_async_found_candidate(self):
        now = datetime.now(timezone.utc)
        user_id = "user-1"
        total_amount = 1250.00
        shopee_ing_id = "ing-shopee-1"

        # Candidate SMS ingestion with card account
        sms_candidate = PendingIngestion(
            id="ing-sms-1",
            user_id=user_id,
            hook_id="hook-sms-1",
            received_at=now - timedelta(minutes=2),
            raw_payload={},
            raw_msg="SMS: Credit card charged PHP 1250.00 at Shopee",
            ai_parsed=AiParsedData(
                amount=1250.00,
                credit_account_id="acc-credit-card-bpi",
                date=now - timedelta(minutes=2)
            ),
            month_key="2026-08",
            partition_key=user_id,
            notification_type="sms"
        )

        self.mock_repo.find_by_amount_and_time_async.return_value = [sms_candidate]

        credit_acc, matched_id = await self.service._resolve_source_account_async(
            total_amount=total_amount,
            email_timestamp=now,
            user_id=user_id,
            shopee_ingestion_id=shopee_ing_id
        )

        self.assertEqual(credit_acc, "acc-credit-card-bpi")
        self.assertEqual(matched_id, "ing-sms-1")

        # Verify backport link on SMS candidate
        self.assertIn(shopee_ing_id, sms_candidate.possible_related_ingestion_ids)
        self.mock_repo.update_async.assert_called_once_with(sms_candidate)

    @patch("services.email_processing_service.publish_signalr_message", new_callable=AsyncMock)
    async def test_process_hook_async_broadcasts_signalr(self, mock_publish_signalr):
        now = datetime.now(timezone.utc)
        user_id = "user-1"
        hook = PhoneHookMessage(
            id="hook-email-test",
            user_id=user_id,
            raw_msg="[EMAIL]: Bank statement notification",
            raw_payload={"sender": "alerts@bpi.com.ph", "subject": "BPI Statement"},
            action="email_received",
            status="received",
            month_key="2026-08-01",
            partition_key="2026-08-01",
            notification_type="email"
        )
        fake_ingestion = PendingIngestion(
            id="ing-email-test",
            user_id=user_id,
            hook_id="hook-email-test",
            received_at=now,
            raw_payload={},
            raw_msg="[EMAIL]: Bank statement notification",
            ai_parsed=AiParsedData(
                amount=100.0,
                summary="Bank statement notification",
                transaction_type="Expense",
                credit_account_id="acc-credit-card-bpi"
            ),
            month_key="2026-08-01",
            partition_key="2026-08-01",
            notification_type="email"
        )

        with patch.object(self.service, "_get_or_bootstrap_email_runbook", new_callable=AsyncMock):
            with patch("services.ingestion_service.IngestionService.process_hook_async", new_callable=AsyncMock, return_value=fake_ingestion):
                res = await self.service.process_hook_async(hook)

        self.assertIsNotNone(res)
        mock_publish_signalr.assert_called_once()
        args, kwargs = mock_publish_signalr.call_args
        self.assertEqual(args[0], "notificationHub")
        self.assertEqual(args[1], "reclassifyComplete")
        self.assertEqual(args[2][1], "hook-email-test")
        self.assertEqual(args[2][0]["id"], "ing-email-test")
        self.assertEqual(kwargs.get("user_id"), user_id)



    async def test_create_transaction_multi_order(self):
        mock_cosmos_client = MagicMock()
        mock_db = MagicMock()
        mock_tx_container = AsyncMock()
        mock_acc_container = AsyncMock()

        mock_cosmos_client.get_database_client.return_value = mock_db
        def get_container_side_effect(name):
            if name == "Transactions":
                return mock_tx_container
            elif name == "Accounts":
                return mock_acc_container
            return AsyncMock()
        mock_db.get_container_client.side_effect = get_container_side_effect

        mock_acc_container.read_item.return_value = {"CurrentBalance": 1000.0}

        finance_api = FinanceApiService()
        finance_api.client = mock_cosmos_client

        now = datetime.now(timezone.utc)
        multi_orders = [
            {"amount": 750.00, "reference_number": "#260808R1R49PTC", "debit_account_id": "acc-shopee-expense", "notes": "shottbeveragesph"},
            {"amount": 500.00, "reference_number": "#260808XYZABC", "debit_account_id": "acc-shopee-expense", "notes": "anothersellerph"}
        ]

        shopee_ingestion = PendingIngestion(
            id="ing-shopee-multi",
            user_id="user-1",
            hook_id="hook-1",
            received_at=now,
            raw_payload={},
            raw_msg="[EMAIL]: Shopee checkout for 2 orders",
            ai_parsed=AiParsedData(
                amount=1250.00,
                transaction_type="Expense",
                credit_account_id="acc-credit-card-bpi",
                debit_account_id="acc-shopee-expense",
                multi_order_items=multi_orders,
                date=now
            ),
            month_key="2026-08",
            partition_key="user-1",
            notification_type="email"
        )

        tx_doc = await finance_api.create_transaction_async(shopee_ingestion)

        self.assertIsNotNone(tx_doc)
        # Verify 1 Transaction created + 1 Credit Entry + 2 Debit Entries = 4 create_item calls
        self.assertEqual(mock_tx_container.create_item.call_count, 4)

        created_items = [call[0][0] for call in mock_tx_container.create_item.call_args_list]
        tx_item = [i for i in created_items if i.get("$type") == "Transaction"][0]
        entries = [i for i in created_items if i.get("$type") == "LedgerEntry"]

        self.assertEqual(len(entries), 3)

        credit_entries = [e for e in entries if e["Amount"] < 0]
        debit_entries = [e for e in entries if e["Amount"] > 0]

        self.assertEqual(len(credit_entries), 1)
        self.assertEqual(credit_entries[0]["Amount"], -1250.00)
        self.assertEqual(credit_entries[0]["AccountId"], "acc-credit-card-bpi")

        self.assertEqual(len(debit_entries), 2)
        self.assertEqual(debit_entries[0]["Amount"], 750.00)
        self.assertEqual(debit_entries[0]["ReferenceNumber"], "#260808R1R49PTC")
        self.assertEqual(debit_entries[1]["Amount"], 500.00)
        self.assertEqual(debit_entries[1]["ReferenceNumber"], "#260808XYZABC")

if __name__ == "__main__":
    unittest.main()
