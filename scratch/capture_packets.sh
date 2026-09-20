#!/bin/bash
if [ "$EUID" -ne 0 ]; then
  echo "Please run this script with sudo."
  exit 1
fi

CAPTURE_FILE="/home/alexszhang/vCourse.ThaiNotes/scratch/packet_capture.txt"
echo "Capturing packets on port 3002 for 15 seconds..."
timeout 15 tcpdump -n -i any port 3002 > "$CAPTURE_FILE" 2>&1
chown alexszhang:alexszhang "$CAPTURE_FILE"
chmod 644 "$CAPTURE_FILE"
echo "Done! Capture saved to scratch/packet_capture.txt"
