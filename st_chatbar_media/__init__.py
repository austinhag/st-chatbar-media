from importlib.metadata import version, PackageNotFoundError
from pathlib import Path
import streamlit as st

try:
    __version__ = version("st-chatbar-media")
except PackageNotFoundError:
    # Package is not installed (e.g. running from source without install)
    __version__ = "unknown"

BUILD = Path(__file__).parent / "frontend" / "build-v2"

def chatbar_media(key="st_chatbar_media", data=None):
    """
    Renders the chat bar and returns a dict-like result containing triggers.

    Frontend sends: setTriggerValue("submit", payload)
    Read in Python: result.get("submit")
    """
    js = (BUILD / "chatbar_media.js").read_text(encoding="utf-8")
    _component = st.components.v2.component(
        name="st_chatbar_media",
        js=js,
        isolate_styles=False,
    )
    return _component(key=key, data=data or {})
