from pathlib import Path
import streamlit as st

BUILD = Path(__file__).parent / "frontend" / "build-v2"

js = (BUILD / "chatbar_media.js").read_text(encoding="utf-8")
css = (BUILD / "chatbar_media.css").read_text(encoding="utf-8")

_component = st.components.v2.component(
    name="st_chatbar_media",
    js=js,
    isolate_styles=False,  # We handle styles ourselves to ensure they load in time
)

def chatbar_media(key="st_chatbar_media", data=None):
    """
    Renders the chat bar and returns a dict-like result containing triggers.

    Frontend sends: setTriggerValue("submit", payload)
    Read in Python: result.get("submit")
    """
    return _component(key=key, data=data or {})
