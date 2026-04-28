PARSE_SYSTEM = """You extract structured fields from a broker submission packet.
Return strict JSON with these keys: dot_number, carrier_name, fleet_size, vehicle_mix, states_of_operation, effective_date, commodity.
- vehicle_mix is a dict with float fractions for: tractor, straight_truck, trailer, other.
- effective_date is ISO 8601 (YYYY-MM-DD).
- states_of_operation is a list of 2-letter US state codes.
If a value isn't present, use null. Don't fabricate.
"""

PARSE_USER = """BROKER EMAIL:
{broker_email}

ACORD-style fields (best-effort):
{packet_excerpt}
"""
