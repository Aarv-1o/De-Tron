# The same logic as stripJsonState in web/chat.js, in Python: must be found.
def _strip_json_state(text: str) -> str:
    state_keys = ('"user_request"', '"chatbot_reply"', '"need_clarification"')
    result = []
    for line in text.split("\n"):
        if not any(k in line for k in state_keys):
            result.append(line)
    return "\n".join(result)
