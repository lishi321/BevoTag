import pandas as pd
import json
import numpy as np

# List of files exactly as requested
files = [
    "data/bevotag_202610112050-d4bg_facingnorth.csv",
    "data/bevotag_202610112212-6zf7_facing north.csv",
    "data/bevotag_202610112212-6zf7_facing_east.csv",
    "data/bevotag_202610112212-6zf7_facingnorth.csv"
]

# Dictionary to hold the parsed data for each AP
# Structure: ap_data[bssid] = {'ssid': string, 'measurements': [{'x': float, 'y': float, 'rssi': int}]}
ap_data = {}

# 1. Parse the CSV files
for file in files:
    try:
        df = pd.read_csv(file)
        
        # Filter for rows where a scan was recorded
        scan_rows = df[df['type'] == 'scan']
        
        for index, row in scan_rows.iterrows():
            x = row['x_ft']
            y = row['y_ft']
            raw_line = row['line']
            
            try:
                # Parse the JSON payload
                json_data = json.loads(raw_line)
                
                # Check if 'aps' list exists in the parsed JSON
                if 'aps' in json_data:
                    for ap in json_data['aps']:
                        bssid = ap.get('bssid')
                        ssid = ap.get('ssid')
                        rssi = ap.get('rssi')
                        
                        if bssid not in ap_data:
                            ap_data[bssid] = {'ssid': ssid, 'measurements': []}
                            
                        ap_data[bssid]['measurements'].append({'x': x, 'y': y, 'rssi': rssi})
                        
            except json.JSONDecodeError:
                print(f"Skipping malformed JSON at row {index} in {file}")
                
    except FileNotFoundError:
        print(f"Error: File {file} not found.")

# 2. Estimate AP Locations using RSSI Weighted Average
results = []

for bssid, data in ap_data.items():
    measurements = data['measurements']
    
    # We need at least 3 distinct measurements for a meaningful spatial estimate
    if len(measurements) >= 3:
        sum_weights = 0
        sum_x_weighted = 0
        sum_y_weighted = 0
        
        for m in measurements:
            # Convert logarithmic RSSI (dBm) to a linear weight.
            # Using a simplified path loss model where weight = 10^(RSSI / 20)
            weight = 10 ** (m['rssi'] / 20.0) 
            
            sum_weights += weight
            sum_x_weighted += m['x'] * weight
            sum_y_weighted += m['y'] * weight
            
        estimated_x = sum_x_weighted / sum_weights
        estimated_y = sum_y_weighted / sum_weights
        
        results.append({
            'BSSID': bssid,
            'SSID': data['ssid'],
            'Estimated X (ft)': round(estimated_x, 2),
            'Estimated Y (ft)': round(estimated_y, 2),
            'Measurement Count': len(measurements)
        })

# 3. Display the estimated locations
results_df = pd.DataFrame(results)

# Sort by measurement count to see the most reliable estimates first
if not results_df.empty:
    results_df = results_df.sort_values(by='Measurement Count', ascending=False)
    print("\n--- Estimated AP Locations (RSSI Weighted Centroid) ---")
    print(results_df.to_string(index=False))
else:
    print("Not enough data to estimate locations.")