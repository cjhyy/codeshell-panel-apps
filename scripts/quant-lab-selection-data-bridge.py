"""Read-only optional selection evidence. One JSON request in, one JSON result out.

The generated selection-python-source.mjs embeds this exact file for hosts whose
panel asset contract does not include Python files. No scores or orders are made.
"""

import contextlib
import importlib.metadata
import importlib.util
import json
import math
import re
import subprocess
import sys
from datetime import date, datetime, timezone

VERSION = 1
MAX_INPUT_BYTES = 4_000_000
MAX_SYMBOLS = 20
MAX_BARS = 1500
MINIMUM_BARS = 120
FUNDAMENTALS_TIMEOUT_SECONDS = 25
SYMBOL_PATTERN = re.compile(r"(?:SH6\d{5}|SZ[03]\d{5})\Z")
VERIFIED_VERSIONS = {"stockstats": "0.6.8", "efinance": "0.5.9"}

# This worker has a separate lifetime so an upstream socket or retry cannot hold
# the panel request open. All library output goes to stderr; only completed rows
# are streamed out, allowing the parent to retain partial results on timeout.
EFINANCE_WORKER = r'''
import contextlib
import json
import math
import sys
from datetime import datetime, timezone
from urllib.parse import urlparse

def finite(value):
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError):
        return None

symbols = json.load(sys.stdin)["symbols"]
with contextlib.redirect_stdout(sys.stderr):
    import requests
    import efinance
    from efinance.common import get_base_info
    from efinance.shared import session

    original_request = session.request
    def bounded_request(method, url, **kwargs):
        parsed = urlparse(url)
        if (str(method).upper() != "GET" or parsed.hostname != "push2.eastmoney.com"
                or parsed.path != "/api/qt/stock/get" or parsed.username
                or parsed.password or parsed.port not in (None, 80, 443)
                or parsed.scheme not in ("http", "https")):
            raise ValueError("SOURCE_URL_UNSUPPORTED")
        # The library uses HTTP here. Preserve the same resource over TLS.
        url = "https://push2.eastmoney.com/api/qt/stock/get"
        kwargs["timeout"] = (3, 5)
        kwargs["allow_redirects"] = False
        kwargs["verify"] = True
        response = original_request(method, url, **kwargs)
        response.raise_for_status()
        if response.is_redirect:
            raise ValueError("SOURCE_REDIRECT")
        return response

    adapter = requests.adapters.HTTPAdapter(max_retries=0)
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    session.request = bounded_request

for symbol in symbols:
    try:
        quote_id = ("1." if symbol.startswith("SH") else "0.") + symbol[2:]
        with contextlib.redirect_stdout(sys.stderr):
            snapshot = get_base_info(quote_id)
        code = str(snapshot.get("代码", "")).strip()
        if code != symbol[2:]:
            raise ValueError("FUNDAMENTALS_SYMBOL_MISMATCH")
        fields = {key: finite(snapshot.get(key)) for key in
                  ("市盈率(动)", "市净率", "ROE", "净利率")}
        record = {"symbol": symbol, "fields": fields,
                  "observedAt": datetime.now(timezone.utc).isoformat()}
    except Exception as error:
        # Exceptions can contain URLs and provider payloads. Return only the type.
        record = {"symbol": symbol, "error": type(error).__name__}
    sys.stdout.write(json.dumps(record, ensure_ascii=False, allow_nan=False) + "\n")
    sys.stdout.flush()
'''


def finite_number(value):
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError, OverflowError):
        return None


def iso_date(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValueError("DATE_INVALID")
    date.fromisoformat(value)
    return value


def package_status(distribution, module):
    try:
        version = importlib.metadata.version(distribution)
        installed = importlib.util.find_spec(module) is not None
    except (importlib.metadata.PackageNotFoundError, ImportError, ValueError):
        version, installed = None, False
    return {"available": installed, "version": version,
            "reason": None if installed else "PACKAGE_NOT_INSTALLED"}


def probe_providers():
    # Metadata and module discovery are local. Do not import efinance in probe.
    providers = {
        "easyTdx": package_status("easy-tdx", "easy_tdx"),
        "stockstats": package_status("stockstats", "stockstats"),
        "efinance": package_status("efinance", "efinance"),
    }
    providers["easyTdx"].update({
        "supported": False, "api": None,
        "reason": "UPSTREAM_API_UNVERIFIED",
        "sourceStatus": "GitHub and PyPI returned 404 on 2026-09-12",
    })
    for key, expected in VERIFIED_VERSIONS.items():
        status = providers[key]
        status.update({"supported": status["available"] and status["version"] == expected,
                       "verifiedVersion": expected})
        if status["available"] and status["version"] != expected:
            status["reason"] = "PACKAGE_VERSION_UNVERIFIED"
    providers["stockstats"]["api"] = "stockstats.wrap"
    providers["efinance"]["api"] = "efinance.common.get_base_info"
    return providers


def validate_request(payload):
    if not isinstance(payload, dict) or payload.get("action") not in ("probe", "enrich"):
        raise ValueError("ACTION_INVALID")
    if payload["action"] == "probe":
        return payload
    iso_date(payload.get("marketDate"))
    symbols = payload.get("symbols")
    if (not isinstance(symbols, list) or len(symbols) > MAX_SYMBOLS
            or any(not isinstance(symbol, str) or not SYMBOL_PATTERN.fullmatch(symbol)
                   for symbol in symbols) or len(set(symbols)) != len(symbols)):
        raise ValueError("SYMBOLS_INVALID")
    histories = payload.get("histories", [])
    if not isinstance(histories, list) or len(histories) > MAX_SYMBOLS:
        raise ValueError("HISTORIES_INVALID")
    seen = set()
    for history in histories:
        if (not isinstance(history, dict) or history.get("symbol") not in symbols
                or history["symbol"] in seen):
            raise ValueError("HISTORY_SYMBOL_INVALID")
        seen.add(history["symbol"])
    if not isinstance(payload.get("provisional", False), bool):
        raise ValueError("PROVISIONAL_INVALID")
    if "generatedAt" in payload:
        value = payload["generatedAt"]
        if not isinstance(value, str):
            raise ValueError("GENERATED_AT_INVALID")
        timestamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if timestamp.tzinfo is None:
            raise ValueError("GENERATED_AT_INVALID")
    return payload


def unavailable_technical(reason, bar_count=0, as_of=None, adjustment=None):
    return {"available": False, "asOf": as_of, "adjustment": adjustment,
            "barCount": bar_count, "rsi14": None, "atr14": None, "atrPercent": None,
            "macd": None, "macdSignal": None, "adx14": None, "reason": reason}


def validate_history(history, market_date, provisional):
    if not history:
        raise ValueError("HISTORY_MISSING")
    if history.get("adjustment") != "qfq":
        raise ValueError("QFQ_HISTORY_REQUIRED")
    bars = history.get("bars")
    if not isinstance(bars, list) or len(bars) > MAX_BARS or not bars:
        raise ValueError("HISTORY_BARS_INVALID")
    validated = []
    previous_date = ""
    for bar in bars:
        if not isinstance(bar, dict):
            raise ValueError("HISTORY_BAR_INVALID")
        bar_date = iso_date(bar.get("date"))
        if bar_date <= previous_date or bar_date > market_date:
            raise ValueError("HISTORY_DATE_ORDER_OR_CUTOFF")
        previous_date = bar_date
        numbers = {key: finite_number(bar.get(key)) for key in
                   ("open", "high", "low", "close", "volume")}
        if (any(value is None for value in numbers.values())
                or any(numbers[key] <= 0 for key in ("open", "high", "low", "close"))
                or numbers["volume"] < 0
                or numbers["low"] > min(numbers["open"], numbers["close"])
                or numbers["high"] < max(numbers["open"], numbers["close"])):
            raise ValueError("HISTORY_OHLCV_INVALID")
        if provisional and bar_date == market_date:
            continue
        validated.append({"date": bar_date, **numbers})
    if not validated:
        raise ValueError("CLOSED_HISTORY_MISSING")
    if not provisional and validated[-1]["date"] != market_date:
        raise ValueError("HISTORY_STALE")
    # Zero volume is not reliable evidence of a completed, tradable session.
    if validated[-1]["volume"] <= 0:
        raise ValueError("LAST_BAR_ZERO_VOLUME")
    return validated


def compute_technical(history, market_date, provisional, provider):
    if not provider.get("supported"):
        return unavailable_technical(provider.get("reason") or "PROVIDER_UNAVAILABLE")
    try:
        bars = validate_history(history, market_date, provisional)
    except (ValueError, TypeError) as error:
        return unavailable_technical(str(error))
    count, as_of = len(bars), bars[-1]["date"]
    if count < MINIMUM_BARS:
        return unavailable_technical("INDICATOR_WARMUP_REQUIRED", count, as_of, "qfq")
    try:
        with contextlib.redirect_stdout(sys.stderr):
            import pandas as pd
            from stockstats import wrap

            frame = wrap(pd.DataFrame(bars))
            values = {
                "rsi14": finite_number(frame["rsi_14"].iloc[-1]),
                "atr14": finite_number(frame["atr_14"].iloc[-1]),
                "macd": finite_number(frame["macd"].iloc[-1]),
                "macdSignal": finite_number(frame["macds"].iloc[-1]),
                # stockstats' shortcut adx smooths DX14 with EMA6. Explicit
                # Wilder14 smoothing makes this field's 14-period name honest.
                "adx14": finite_number(frame["dx_14"].ewm(
                    alpha=1 / 14, adjust=True, min_periods=14).mean().iloc[-1]),
            }
        values["atrPercent"] = (values["atr14"] / bars[-1]["close"] * 100
                                if values["atr14"] is not None else None)
        if any(value is None for value in values.values()):
            return unavailable_technical("INDICATOR_NONFINITE", count, as_of, "qfq")
        return {"available": True, "asOf": as_of, "adjustment": "qfq", "barCount": count,
                **values, "reason": None,
                "calculation": {"rsi": "stockstats rsi_14", "atr": "stockstats atr_14",
                                "macd": "stockstats 12/26/9; histogram is unscaled",
                                "adx": "stockstats dx_14; Wilder alpha=1/14, adjust=True"}}
    except Exception as error:
        return unavailable_technical("INDICATOR_ERROR:" + type(error).__name__, count, as_of, "qfq")


def unavailable_fundamentals(reason):
    return {"available": False, "observedAt": None, "reportDate": None, "disclosureDate": None,
            "pe": None, "pb": None, "roe": None, "netProfitMargin": None,
            "revenueYoY": None, "profitYoY": None, "reason": reason}


def normalize_fundamentals(record):
    if record.get("error"):
        return unavailable_fundamentals("PROVIDER_ERROR:" + str(record["error"])[:80])
    fields = record.get("fields", {})
    values = {key: finite_number(fields.get(source)) for key, source in {
        "pe": "市盈率(动)", "pb": "市净率", "roe": "ROE", "netProfitMargin": "净利率",
    }.items()}
    if not any(value is not None for value in values.values()):
        return unavailable_fundamentals("FUNDAMENTALS_FIELDS_MISSING")
    return {"available": True, "observedAt": record.get("observedAt"),
            "reportDate": None, "disclosureDate": None, **values,
            "revenueYoY": None, "profitYoY": None,
            "reason": "CURRENT_SNAPSHOT_NO_DISCLOSURE_DATE",
            "peBasis": "dynamic", "pointInTimeEligible": False}


def fetch_fundamentals(symbols, provider, run=subprocess.run):
    if not provider.get("supported"):
        return {symbol: unavailable_fundamentals(provider.get("reason") or "PROVIDER_UNAVAILABLE")
                for symbol in symbols}
    if not symbols:
        return {}
    reason = "PROVIDER_NO_RESULT"
    try:
        result = run([sys.executable, "-B", "-c", EFINANCE_WORKER],
                     input=json.dumps({"symbols": symbols}), text=True,
                     stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                     timeout=FUNDAMENTALS_TIMEOUT_SECONDS, check=False)
        output = result.stdout
        if result.returncode:
            reason = "PROVIDER_PROCESS_ERROR"
    except subprocess.TimeoutExpired as error:
        output = error.stdout or ""
        reason = "PROVIDER_TIMEOUT"
    except OSError:
        output, reason = "", "PROVIDER_PROCESS_UNAVAILABLE"
    if isinstance(output, bytes):
        output = output.decode("utf-8", errors="replace")
    records = {symbol: unavailable_fundamentals(reason) for symbol in symbols}
    for line in output.splitlines():
        try:
            record = json.loads(line)
            if isinstance(record, dict) and record.get("symbol") in records:
                records[record["symbol"]] = normalize_fundamentals(record)
        except (ValueError, TypeError, AttributeError):
            continue
    return records


def dispatch(payload, providers=None, fundamentals_fetcher=fetch_fundamentals):
    payload = validate_request(payload)
    providers = providers if providers is not None else probe_providers()
    result = {"version": VERSION, "providers": providers, "stocks": []}
    if payload["action"] == "probe":
        return result
    histories = {item["symbol"]: item for item in payload.get("histories", [])}
    for symbol in payload["symbols"]:
        result["stocks"].append({
            "symbol": symbol,
            "technical": compute_technical(histories.get(symbol), payload["marketDate"],
                                           payload.get("provisional", False), providers["stockstats"]),
            "quoteCheck": {"available": False, "asOf": None, "price": None,
                           "adjustment": "none", "reason": "UPSTREAM_API_UNVERIFIED"},
        })
    fundamentals = fundamentals_fetcher(payload["symbols"], providers["efinance"])
    for stock in result["stocks"]:
        stock["fundamentals"] = fundamentals.get(
            stock["symbol"], unavailable_fundamentals("PROVIDER_NO_RESULT"))
    return result


def reject_nonfinite(_value):
    raise ValueError("JSON_NONFINITE")


def main():
    try:
        raw = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
        if len(raw) > MAX_INPUT_BYTES:
            raise ValueError("INPUT_TOO_LARGE")
        payload = json.loads(raw, parse_constant=reject_nonfinite)
        with contextlib.redirect_stdout(sys.stderr):
            result = dispatch(payload)
        sys.stdout.write(json.dumps(result, ensure_ascii=False, allow_nan=False) + "\n")
    except Exception as error:
        reason = str(error)[:160] if isinstance(error, ValueError) else type(error).__name__
        sys.stdout.write(json.dumps({"version": VERSION, "ok": False,
                                    "errorCode": "BRIDGE_REQUEST_FAILED", "reason": reason}) + "\n")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
