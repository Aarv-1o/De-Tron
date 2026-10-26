def handler(event, context):
    records = event.get("Records", [])
    total = 0
    for record in records:
        total += len(record.get("body", ""))
    return {"count": len(records), "bytes": total}


def main():
    import sys
    for arg in sys.argv[1:]:
        print(f"arg: {arg}")
    return len(sys.argv)
