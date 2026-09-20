#!/bin/bash
# Check if script is run as root
if [ "$EUID" -ne 0 ]; then
  echo "Please run this script with sudo."
  exit 1
fi

DEBUG_FILE="/home/alexszhang/vCourse.ThaiNotes/scratch/firewall_debug.txt"

echo "=== Firewall Debug Report ===" > "$DEBUG_FILE"
echo "Generated at: $(date)" >> "$DEBUG_FILE"

echo -e "\n=== UFW Status ===" >> "$DEBUG_FILE"
ufw status verbose >> "$DEBUG_FILE" 2>&1

echo -e "\n=== IPTables Rules (Symmetric) ===" >> "$DEBUG_FILE"
iptables -S >> "$DEBUG_FILE" 2>&1

echo -e "\n=== IPTables Active Chains ===" >> "$DEBUG_FILE"
iptables -L -n -v >> "$DEBUG_FILE" 2>&1

echo -e "\n=== Route Table ===" >> "$DEBUG_FILE"
ip route show >> "$DEBUG_FILE" 2>&1

echo -e "\n=== Socket Bindings ===" >> "$DEBUG_FILE"
ss -tulnp >> "$DEBUG_FILE" 2>&1

chown alexszhang:alexszhang "$DEBUG_FILE"
chmod 644 "$DEBUG_FILE"

echo "Success! Firewall debug report written to: scratch/firewall_debug.txt"
