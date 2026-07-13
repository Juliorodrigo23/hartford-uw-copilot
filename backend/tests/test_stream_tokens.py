"""Token streaming must reproduce the memo byte-for-byte."""

from app.api.chat import split_stream_tokens


def test_roundtrip_plain():
    text = "Decline OR quote with surcharge."
    assert "".join(split_stream_tokens(text)) == text


def test_roundtrip_markdown_whitespace():
    text = "## Memo\n\n- bullet one\n- bullet two\n\n```json\n{\"a\": 1}\n```\n"
    assert "".join(split_stream_tokens(text)) == text


def test_roundtrip_multiple_spaces_and_tabs():
    text = "a  b\tc\n\n  indented"
    assert "".join(split_stream_tokens(text)) == text


def test_empty():
    assert split_stream_tokens("") == []
