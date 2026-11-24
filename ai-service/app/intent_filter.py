import re

INTENTS = (
    "general_finance",
    "spending_analysis",
    "budget_advice",
    "saving_goal",
    "transaction_help",
    "account_help",
    "out_of_scope",
)

_TAG = re.compile(r"\s*\[\[intent:([a-z_]+)\]\]")
_OPEN = "[[intent:"


class IntentTagFilter:
    """
    The model ends a text answer with a tag such as ``[[intent:budget_advice]]``. While streaming, this removes the tag
    from the text the user sees. Text that could be the start of a tag is held back until it is clear whether it is one.
    """

    def __init__(self) -> None:
        self._pending = ""
        self.intent: str | None = None

    def feed(self, text: str) -> str:
        buffer = self._pending + text
        buffer = _TAG.sub(self._take, buffer)
        hold = self._hold_from(buffer)
        self._pending = buffer[hold:]
        return buffer[:hold]

    def finish(self) -> str:
        """Returns the text still held back. An unfinished tag at the very end is dropped."""
        rest = _TAG.sub(self._take, self._pending)
        self._pending = ""
        start = rest.rfind("[[")
        if start != -1:
            tail = rest[start:]
            if _OPEN.startswith(tail) or tail.startswith(_OPEN):
                rest = rest[:start].rstrip()
        return rest

    def _take(self, match: re.Match) -> str:
        if match.group(1) in INTENTS:
            self.intent = match.group(1)
        return ""

    @staticmethod
    def _hold_from(buffer: str) -> int:
        """Index from which the buffer may still turn into a tag (possibly with whitespace in front)."""
        start = buffer.rfind("[")
        if start == -1:
            return len(buffer)
        if start > 0 and buffer[start - 1] == "[":
            start -= 1
        tail = buffer[start:]
        could_be_tag = _OPEN.startswith(tail) or (tail.startswith(_OPEN) and "]]" not in tail and len(tail) < 40)
        if not could_be_tag:
            return len(buffer)
        while start > 0 and buffer[start - 1] in " \t\r\n":
            start -= 1
        return start
