# st-chatbar-media

A Streamlit custom component that provides a polished, multimodal chat input bar with:

- Text input (multiline, word wrap)
- Audio recording (WAV) with one-tap record and stop
- Photo attach flow with Upload or Camera, including camera selection and preview
- A clean chatbar UI you can pin/position with CSS

This package is published to PyPI as `st-chatbar-media` and imported in Python as `chatbar_media`.

---

## Install

```bash
pip install st-chatbar-media
```

---

## Quick start

```python
import streamlit as st
from st_chatbar_media import chatbar_media

st.set_page_config(layout="wide")
st.title("st-chatbar-media demo")

st.session_state.setdefault("events", [])

result = chatbar_media(
    key="chatbar",
    data={
        "placeholder": "Type a message…  (Ctrl+Enter to send)",
        "disabled": False,
        "responsive": True,
    },
)

payload = result.get("submit") if result else None
if payload:
    st.session_state.events.append(payload)
    st.rerun()

st.write(st.session_state.events[-1] if st.session_state.events else "No events yet.")
```
---

## How it works (Streamlit Components v2)

This package uses **Streamlit Components v2** (`st.components.v2.component`) on the Python side and the **v2 frontend renderer** (`@streamlit/component-v2-lib`) on the TypeScript side.

Key points:

- **Inputs** are passed from Python to the frontend via the `data=` dict (available as `component.data` in the renderer).
- The frontend sends events back to Python using a **trigger**, typically:
  - `component.setTriggerValue("submit", payload)`
- In Python, you read the trigger from the component return value:
  - `payload = result.get("submit")`

Why v2:

- Cleaner, more explicit data flow (`data` + triggers).
- Easier event-driven patterns for chat inputs (you only react when `"submit"` fires).

---

## Parameters

Pass parameters via `data=`.

Supported keys:

- `placeholder` (string): placeholder text for the textarea
- `responsive` (bool): toggle responsive behaviors in CSS/JS
- `disabled` (bool): disables UI interaction (buttons + input)

Example:

```python
result = chatbar_media(
    key="chatbar",
    data={
        "placeholder": "Ask me anything…",
        "responsive": False,
        "disabled": False,
    },
)
```

---

## Payload format

When the user submits text, records audio, or attaches an image, the component returns a dict-like result with a `submit` payload.

Example payload keys:

- `text` (string)
- `audioFile` (list of ints 0–255, raw file bytes)
- `audioMime` (string, typically `"audio/wav"`)
- `imageFile` (list of ints 0–255, raw file bytes)
- `imageMime` (string, typically `"image/jpeg"`)

### Converting to bytes in Python

```python
payload = result.get("submit")
if payload and payload.get("audioFile"):
    audio_bytes = bytes(payload["audioFile"])

if payload and payload.get("imageFile"):
    image_bytes = bytes(payload["imageFile"])
    image_mime = payload.get("imageMime", "image/jpeg")
```

---


## Styling and layout

The component ships with default styling. You can further customize layout via CSS in your Streamlit app.

## Local development

### Prereqs
- Python 3.9+
- Node.js 18+ recommended

### Setup

```bash
python -m venv .venv
# Windows PowerShell:
.\.venv\Scripts\Activate.ps1

pip install -e .
pip install streamlit

cd frontend
npm install
```

### Build the frontend bundle

```bash
cd frontend
npm run build:v2
```

Then run a demo app:

```bash
streamlit run examples/demo_app.py
```

---

## License

MIT (or update this section to match your repository license).

---

## Contributing

Issues and PRs welcome. If you open a PR, please include:
- a short description of the change
- screenshots for UI changes
- a note on whether it affects payload shape
