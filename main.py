import streamlit as st
import os

st.title("Plumbing Check")

# This will tell us if the key is actually reaching the app
key_check = os.getenv("OPENAI_API_KEY")

if key_check:
    st.success(f"✅ The Key is connected! It starts with: {key_check[:7]}...")
    st.info("Now delete this test code and paste the Full Power code back in.")
else:
    st.error("❌ The Key is still missing. Upsun is not passing the 'env:OPENAI_API_KEY' to the app.")
    st.write("Current system variables found:")
    st.write(list(os.environ.keys()))
