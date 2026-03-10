import streamlit as st
from st_chatbar_media import chatbar_media

st.set_page_config(layout="wide")
st.title("chatbar-media demo")
st.sidebar.markdown("Demo chatbar app")
st.session_state.setdefault("events", [])

result = chatbar_media(
    key="chatbar",
    data={"placeholder": "Type, record audio or add a photo...",
          "disabled": False,
          "responsive": True}
)

payload = result.get("submit") if result else None
if payload:
    st.session_state.events.append(payload)
    st.rerun()

st.subheader("Latest payload")
st.write(st.session_state.events[-1] if st.session_state.events else None)

st.subheader("All events")
for i, e in enumerate(st.session_state.events):
    st.write(f"{i+1}. keys={list(e.keys())}")
    if e.get("text"):
        st.write("text:", e["text"])
    if e.get("audioFile"):
        st.write("audio bytes:", len(e["audioFile"]))
        st.audio(bytes(e["audioFile"]))
    if e.get("imageFile"):
        img_bytes = bytes(e["imageFile"])
        st.write("image bytes:", len(img_bytes), "mime:", e.get("imageMime"))
        st.image(img_bytes)