def up(db):
    """
    Migration:
    1. Query all recurring transactions in RecurringTransactions container.
    2. Set 'Status' to 'Active' if missing or null.
    """
    container = db.get_container_client("RecurringTransactions")

    print("Querying all recurring transactions...")
    try:
        schedules = list(container.query_items("SELECT * FROM c", enable_cross_partition_query=True))
    except Exception as e:
        print(f"Error querying RecurringTransactions container: {e}")
        schedules = []

    print(f"Found {len(schedules)} recurring transactions.")

    success_count = 0
    error_count = 0

    for schedule in schedules:
        current_status = schedule.get("Status")
        if not current_status:
            schedule["Status"] = "Active"
            try:
                container.replace_item(item=schedule["id"], body=schedule)
                success_count += 1
            except Exception as e:
                print(f"Error updating recurring transaction '{schedule.get('id')}': {e}")
                error_count += 1

    print(f"RecurringTransactions Status Migration: Successfully updated {success_count} records. Errors: {error_count}.")
