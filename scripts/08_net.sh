#!/usr/bin/env bash
# Network check for the three agencies, IPv4 vs IPv6, from the laptop and from inside Docker (where Zetaris fetches).
cd "$(dirname "$0")/.." || exit 1; mkdir -p logs
E='https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_minr?format=JSON&geo=DE&coicop18=CP01&unit=RCH_A&lastTimePeriod=1'
S='https://www150.statcan.gc.ca/t1/wds/rest/getDataFromVectorByReferencePeriodRange?vectorIds=%2241690974%22&startRefPeriod=2026-06-01&endReferencePeriod=2026-09-01'
A='https://data.api.abs.gov.au/rest/data/ABS,CPI/1.20001.10.50.M?startPeriod=2026-06&detail=dataonly'
{
  for u in "$E" "$S" "$A"; do
    h=$(echo "$u" | cut -d/ -f3)
    for f in -4 -6; do echo "$h $f $(curl $f -s -o /dev/null -m 25 -w '%{http_code} %{time_total}s' "$u" 2>&1 || echo FAIL)"; done
  done
  echo "-- inside zetaris-driver container"
  docker exec zetaris-driver-1 bash -c "for u in '$E' '$S' '$A'; do curl -s -o /dev/null -m 25 -w '%{http_code} %{time_total}s\n' \"\$u\" || echo FAIL; done" 2>&1 \
    || echo "(docker exec failed)"
} 2>&1 | tee logs/08_net.log
