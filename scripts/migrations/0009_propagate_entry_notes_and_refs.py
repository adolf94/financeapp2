def up(db):
    """
    Migration:
    1. Rename/initialize 'Comment' -> 'Note' and ensure 'ReferenceNumber' exists on all LedgerEntry documents.
    2. Propagate parent Transaction's Note & ReferenceNumber to appropriate child LedgerEntry based on transaction type:
       - Expense: copy Note & ReferenceNumber to Debit entry (Amount > 0)
       - Income: copy Note & ReferenceNumber to Credit entry (Amount < 0)
       - Transfer: copy Note & ReferenceNumber to Credit entry (Amount < 0)
    3. Update RecurringTransaction TemplateEntries (Comment -> Note, add ReferenceNumber).
    """
    
    # 1. Transactions Container Migration
    tx_container = db.get_container_client("Transactions")
    print("Querying all documents from Transactions container...")
    
    try:
        all_docs = list(tx_container.query_items("SELECT * FROM c", enable_cross_partition_query=True))
    except Exception as e:
        print(f"Error querying Transactions container: {e}")
        all_docs = []

    transactions_by_id = {}
    ledger_entries_by_tx_id = {}
    
    for doc in all_docs:
        # Check if transaction or ledger entry
        doc_type = doc.get("$type") or doc.get("Discriminator")
        if doc_type == "Transaction" or (doc_type is None and "Entries" in doc) or ("Type" in doc and "Date" in doc and "AccountId" not in doc):
            transactions_by_id[doc["id"]] = doc
        elif doc_type == "LedgerEntry" or ("AccountId" in doc and "TransactionId" in doc):
            tx_id = doc.get("TransactionId")
            if tx_id:
                ledger_entries_by_tx_id.setdefault(tx_id, []).append(doc)

    print(f"Found {len(transactions_by_id)} transactions and {sum(len(entries) for entries in ledger_entries_by_tx_id.values())} ledger entries.")

    entry_success = 0
    entry_error = 0

    for tx_id, entries in ledger_entries_by_tx_id.items():
        tx = transactions_by_id.get(tx_id)
        tx_type = tx.get("Type") if tx else None
        tx_note = (tx.get("Note") or "") if tx else ""
        tx_ref = (tx.get("ReferenceNumber") or "") if tx else ""

        for entry in entries:
            updated = False
            
            # Migrate Comment -> Note
            if "Comment" in entry:
                existing_comment = entry.pop("Comment")
                if not entry.get("Note") and existing_comment:
                    entry["Note"] = existing_comment
                updated = True
                
            if "Note" not in entry:
                entry["Note"] = ""
                updated = True

            if "ReferenceNumber" not in entry:
                entry["ReferenceNumber"] = None
                updated = True

            # Propagate from parent Transaction if entry note/ref is empty
            amount = entry.get("Amount", 0)
            
            if tx_type == "Expense" and amount > 0:
                # Debit entry for Expense
                if not entry.get("Note") and tx_note:
                    entry["Note"] = tx_note
                    updated = True
                if not entry.get("ReferenceNumber") and tx_ref:
                    entry["ReferenceNumber"] = tx_ref
                    updated = True
            elif tx_type in ("Income", "Transfer") and amount < 0:
                # Credit entry for Income / Transfer
                if not entry.get("Note") and tx_note:
                    entry["Note"] = tx_note
                    updated = True
                if not entry.get("ReferenceNumber") and tx_ref:
                    entry["ReferenceNumber"] = tx_ref
                    updated = True

            if updated:
                try:
                    tx_container.replace_item(item=entry["id"], body=entry)
                    entry_success += 1
                except Exception as e:
                    print(f"Error updating ledger entry '{entry.get('id')}': {e}")
                    entry_error += 1

    print(f"Transactions Container: Successfully updated {entry_success} ledger entries. Errors: {entry_error}.")

    # 2. Recurring Transactions Migration
    try:
        rec_container = db.get_container_client("RecurringTransactions")
        rec_docs = list(rec_container.query_items("SELECT * FROM c", enable_cross_partition_query=True))
    except Exception as e:
        print(f"Error querying RecurringTransactions container: {e}")
        rec_docs = []

    rec_success = 0
    rec_error = 0

    for rec in rec_docs:
        updated = False
        template_entries = rec.get("TemplateEntries") or []
        rec_type = rec.get("TemplateType")
        rec_note = rec.get("TemplateNote") or ""

        for entry in template_entries:
            if "Comment" in entry:
                comment_val = entry.pop("Comment")
                if not entry.get("Note") and comment_val:
                    entry["Note"] = comment_val
                updated = True
            if "Note" not in entry:
                entry["Note"] = None
                updated = True
            if "ReferenceNumber" not in entry:
                entry["ReferenceNumber"] = None
                updated = True

            amount = entry.get("Amount", 0)
            if rec_type == "Expense" and amount > 0:
                if not entry.get("Note") and rec_note:
                    entry["Note"] = rec_note
                    updated = True
            elif rec_type in ("Income", "Transfer") and amount < 0:
                if not entry.get("Note") and rec_note:
                    entry["Note"] = rec_note
                    updated = True

        if updated:
            try:
                rec_container.replace_item(item=rec["id"], body=rec)
                rec_success += 1
            except Exception as e:
                print(f"Error updating recurring transaction '{rec.get('id')}': {e}")
                rec_error += 1

    print(f"RecurringTransactions Container: Successfully updated {rec_success} recurring templates. Errors: {rec_error}.")
