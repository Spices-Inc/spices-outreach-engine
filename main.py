import os
import requests
import google.generativeai as genai

# 1. API CONFIGURATION
APOLLO_KEY = os.environ.get('APOLLO_API_KEY')
HUNTER_KEY = os.environ.get('HUNTER_API_KEY')
GEMINI_KEY = os.environ.get('GEMINI_API_KEY')

# 2. LOGISTICS ZONES (Your SCF Data)
ZONE_1_DAY = ['112', '180', '160', '123', '227', '118', '195', '052', '178', '170', '211', '217', '121', '088', '172', '177', '100', '103', '109', '114', '150', '188', '142', '139', '105', '128', '174', '184', '113', '201', '144']
ZONE_2_DAY = ['480', '445', '450', '551', '040', '606', '217', '432', '371', '365', '038', '625', '497', '481', '502', '537', '495', '281', '342', '193', '232', '601', '612', '287', '618', '303', '602', '029', '366', '065']

def get_shipping_speed(zip_code):
    prefix = str(zip_code)[:3]
    if prefix in ZONE_1_DAY:
        return "Next-Day Delivery"
    elif prefix in ZONE_2_DAY:
        return "Fast 2-Day Shipping"
    return "Reliable Nationwide Shipping"

def run_outreach():
    print("🚀 Spices Inc Engine: Starting Daily Batch...")
    # Test logic check
    test_zip = "11232" 
    speed = get_shipping_speed(test_zip)
    print(f"✅ Logistics Check: Zip {test_zip} identified as {speed}")

if __name__ == "__main__":
    run_outreach()
