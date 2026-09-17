"""Offline evidence-contract tests; install requirements-selection.txt for indicators."""

import importlib.util
import contextlib
import io
import json
import math
from pathlib import Path
import subprocess
import sys
import types
import unittest
from datetime import date, timedelta
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "scripts/quant-lab-selection-data-bridge.py"
SPEC = importlib.util.spec_from_file_location("selection_bridge", SOURCE)
bridge = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bridge)


def fixture_bars(count=180):
    bars = []
    for index in range(count):
        close = 10 + index * 0.04 + math.sin(index * 0.7) * 0.3
        bars.append({"date": str(date(2026, 1, 1) + timedelta(days=index)),
                     "open": close - 0.02, "high": close + 0.1, "low": close - 0.12,
                     "close": close, "volume": 10_000 + index * 4})
    return bars


def fixture_request(count=180):
    bars = fixture_bars(count)
    return {"action": "enrich", "marketDate": bars[-1]["date"], "symbols": ["SH600519"],
            "histories": [{"symbol": "SH600519", "adjustment": "qfq", "bars": bars}]}


def enabled_provider():
    return {"available": True, "supported": True, "version": "fixture", "reason": None}


def completed_record(symbol="SH600519"):
    return {"symbol": symbol, "observedAt": "2026-09-12T00:00:00+00:00",
            "fields": {"市盈率(动)": 18.5, "市净率": 3.2, "ROE": 10.2, "净利率": 9.3}}


class RequestTests(unittest.TestCase):
    def test_probe_is_offline_without_imports_or_provider_calls(self):
        def forbidden_fetch(*_args):
            raise AssertionError("network")
        result = bridge.dispatch({"action": "probe"}, fundamentals_fetcher=forbidden_fetch)
        self.assertEqual(result["stocks"], [])
        self.assertFalse(result["providers"]["easyTdx"]["supported"])

    def test_duplicate_and_over_limit_symbols_rejected(self):
        request = fixture_request()
        for symbols in (["SH600519", "SH600519"], [f"SH{600000+i}" for i in range(21)]):
            request["symbols"] = symbols
            with self.assertRaisesRegex(ValueError, "SYMBOLS_INVALID"):
                bridge.validate_request(request)

    def test_symbol_and_history_identity_rejected(self):
        request = fixture_request()
        request["histories"][0]["symbol"] = "SZ000001"
        with self.assertRaisesRegex(ValueError, "HISTORY_SYMBOL_INVALID"):
            bridge.validate_request(request)
        request["symbols"] = ["SH000001"]
        with self.assertRaisesRegex(ValueError, "SYMBOLS_INVALID"):
            bridge.validate_request(request)

    def test_json_nonfinite_and_extra_payload_rejected(self):
        for raw in ('{"action":"probe","x":NaN}', '{"action":"probe"}\n{}'):
            result = subprocess.run([sys.executable, "-B", str(SOURCE)], input=raw,
                                    text=True, capture_output=True, check=False)
            self.assertEqual(result.returncode, 1)
            self.assertEqual(len(result.stdout.splitlines()), 1)
            self.assertEqual(json.loads(result.stdout)["errorCode"], "BRIDGE_REQUEST_FAILED")

    def test_embedded_source_matches_development_source(self):
        result = subprocess.run([
            "node", "--input-type=module", "-e",
            "import {PYTHON_SOURCE} from './apps/quant-lab/app/tools/selection-python-source.mjs';"
            "process.stdout.write(PYTHON_SOURCE);",
        ], cwd=ROOT, text=True, capture_output=True, check=True)
        self.assertEqual(result.stdout, SOURCE.read_text())
        # The packaged runtime really runs with -c, where __file__ is unavailable.
        probe = subprocess.run([sys.executable, "-B", "-c", result.stdout],
                               input='{"action":"probe"}', text=True,
                               capture_output=True, check=True)
        self.assertEqual(json.loads(probe.stdout)["version"], 1)


class HistoryTests(unittest.TestCase):
    def test_provisional_removes_unclosed_daily_bar(self):
        request = fixture_request()
        bars = bridge.validate_history(request["histories"][0], request["marketDate"], True)
        self.assertEqual(len(bars), 179)
        self.assertLess(bars[-1]["date"], request["marketDate"])

    def test_future_duplicate_unsorted_and_stale_bars_fail_closed(self):
        request = fixture_request()
        history = request["histories"][0]
        with self.assertRaisesRegex(ValueError, "HISTORY_DATE_ORDER_OR_CUTOFF"):
            bridge.validate_history(history, history["bars"][-2]["date"], False)
        history["bars"][1]["date"] = history["bars"][0]["date"]
        with self.assertRaisesRegex(ValueError, "HISTORY_DATE_ORDER_OR_CUTOFF"):
            bridge.validate_history(history, request["marketDate"], False)
        history["bars"] = fixture_bars()[::-1]
        with self.assertRaisesRegex(ValueError, "HISTORY_DATE_ORDER_OR_CUTOFF"):
            bridge.validate_history(history, request["marketDate"], False)
        history["bars"] = fixture_bars()[:-1]
        with self.assertRaisesRegex(ValueError, "HISTORY_STALE"):
            bridge.validate_history(history, request["marketDate"], False)

    def test_raw_prices_nan_invalid_ohlc_and_zero_last_volume_fail_closed(self):
        request = fixture_request()
        for field, value in (("close", float("nan")), ("high", 0.5), ("volume", 0)):
            history = fixture_request()["histories"][0]
            history["bars"][-1][field] = value
            with self.assertRaises(ValueError):
                bridge.validate_history(history, request["marketDate"], False)
        history = request["histories"][0]
        history["adjustment"] = "none"
        with self.assertRaisesRegex(ValueError, "QFQ_HISTORY_REQUIRED"):
            bridge.validate_history(history, request["marketDate"], False)

    def test_insufficient_warmup_is_not_reported_as_signal(self):
        request = fixture_request(60)
        result = bridge.compute_technical(request["histories"][0], request["marketDate"],
                                          False, enabled_provider())
        self.assertFalse(result["available"])
        self.assertEqual(result["barCount"], 60)
        self.assertEqual(result["reason"], "INDICATOR_WARMUP_REQUIRED")
        self.assertIsNone(result["rsi14"])

    @unittest.skipUnless(bridge.probe_providers()["stockstats"]["supported"],
                         "optional pinned stockstats runtime is not installed")
    def test_actual_stockstats_outputs_have_fixture_values_and_cutoff(self):
        request = fixture_request()
        result = bridge.compute_technical(request["histories"][0], request["marketDate"],
                                          False, enabled_provider())
        self.assertTrue(result["available"], result)
        self.assertAlmostEqual(result["atrPercent"],
                               result["atr14"] / request["histories"][0]["bars"][-1]["close"] * 100)
        self.assertTrue(0 <= result["rsi14"] <= 100)
        self.assertTrue(0 <= result["adx14"] <= 100)
        # These fixture values detect incorrect window names, scale changes and
        # accidentally using the package's EMA6 ADX shortcut as ADX14.
        self.assertAlmostEqual(result["rsi14"], 62.93848823082827, places=8)
        self.assertAlmostEqual(result["adx14"], 27.642394273143847, places=8)
        self.assertAlmostEqual(result["macd"], 0.24381160620505327, places=8)
        self.assertGreater(result["atr14"], 0)
        provisional = bridge.compute_technical(request["histories"][0], request["marketDate"],
                                                True, enabled_provider())
        self.assertTrue(provisional["available"], provisional)
        self.assertEqual(provisional["barCount"], 179)
        self.assertEqual(provisional["asOf"], request["histories"][0]["bars"][-2]["date"])
        self.assertNotEqual(provisional["macd"], result["macd"])
        self.assertNotIn("score", result)


class FundamentalsTests(unittest.TestCase):
    def test_worker_uses_exact_identity_bounded_tls_and_clean_json(self):
        captured = []
        response = types.SimpleNamespace(raise_for_status=lambda: None, is_redirect=False)
        def request(method, url, **kwargs):
            captured.append((method, url, kwargs))
            return response
        session = types.SimpleNamespace(request=request, mount=lambda *_args: None)
        def get_base_info(quote_id):
            self.assertEqual(quote_id, "1.600519")
            print("provider progress should not corrupt JSON")
            session.request("GET", "http://push2.eastmoney.com/api/qt/stock/get")
            return {"代码": "600519", **completed_record()["fields"]}
        mock_modules = {
            "requests": types.SimpleNamespace(adapters=types.SimpleNamespace(
                HTTPAdapter=lambda **_kwargs: object())),
            "efinance": types.ModuleType("efinance"),
            "efinance.common": types.SimpleNamespace(get_base_info=get_base_info),
            "efinance.shared": types.SimpleNamespace(session=session),
        }
        output, logs = io.StringIO(), io.StringIO()
        with (patch.dict(sys.modules, mock_modules),
              patch.object(sys, "stdin", io.StringIO('{"symbols":["SH600519"]}')),
              contextlib.redirect_stdout(output), contextlib.redirect_stderr(logs)):
            exec(bridge.EFINANCE_WORKER, {})
        record = json.loads(output.getvalue())
        self.assertEqual(record["symbol"], "SH600519")
        self.assertEqual(record["fields"]["ROE"], 10.2)
        self.assertIn("provider progress", logs.getvalue())
        self.assertEqual(captured[0][1], "https://push2.eastmoney.com/api/qt/stock/get")
        self.assertEqual(captured[0][2]["timeout"], (3, 5))
        self.assertFalse(captured[0][2]["allow_redirects"])
        self.assertTrue(captured[0][2]["verify"])
        with self.assertRaisesRegex(ValueError, "SOURCE_URL_UNSUPPORTED"):
            session.request("POST", "https://push2.eastmoney.com/api/qt/stock/get")
        with self.assertRaisesRegex(ValueError, "SOURCE_URL_UNSUPPORTED"):
            session.request("GET", "https://example.com/api/qt/stock/get")

    def test_snapshot_never_invents_disclosure_dates_or_growth(self):
        result = bridge.normalize_fundamentals(completed_record())
        self.assertTrue(result["available"])
        self.assertEqual(result["pe"], 18.5)
        for key in ("reportDate", "disclosureDate", "revenueYoY", "profitYoY"):
            self.assertIsNone(result[key])
        self.assertFalse(result["pointInTimeEligible"])
        self.assertEqual(result["reason"], "CURRENT_SNAPSHOT_NO_DISCLOSURE_DATE")

    def test_missing_values_remain_null(self):
        record = completed_record()
        record["fields"] = {"市盈率(动)": "-", "ROE": float("nan")}
        result = bridge.normalize_fundamentals(record)
        self.assertFalse(result["available"])
        self.assertIsNone(result["pe"])
        self.assertIsNone(result["roe"])

    def test_worker_timeout_preserves_completed_stocks(self):
        partial = json.dumps(completed_record()).encode() + b"\n"
        def timeout(*args, **kwargs):
            self.assertEqual(kwargs["timeout"], 25)
            raise subprocess.TimeoutExpired(args[0], 25, output=partial)
        result = bridge.fetch_fundamentals(["SH600519", "SZ000001"], enabled_provider(), run=timeout)
        self.assertTrue(result["SH600519"]["available"])
        self.assertEqual(result["SZ000001"]["reason"], "PROVIDER_TIMEOUT")

    def test_non_json_worker_output_and_symbol_mismatch_are_ignored(self):
        def mocked_run(*args, **kwargs):
            return subprocess.CompletedProcess(args[0], 0,
                "upstream library banner\n" + json.dumps(completed_record("SZ000001")) + "\n", "")
        result = bridge.fetch_fundamentals(["SH600519"], enabled_provider(), run=mocked_run)
        self.assertEqual(result["SH600519"]["reason"], "PROVIDER_NO_RESULT")

    def test_provider_failure_does_not_remove_technical_or_quote_evidence(self):
        providers = {"stockstats": {"supported": False, "reason": "PACKAGE_NOT_INSTALLED"},
                     "efinance": {"supported": False, "reason": "PACKAGE_NOT_INSTALLED"},
                     "easyTdx": {"supported": False}}
        result = bridge.dispatch(fixture_request(), providers=providers)
        stock = result["stocks"][0]
        self.assertFalse(stock["fundamentals"]["available"])
        self.assertFalse(stock["technical"]["available"])
        self.assertEqual(stock["quoteCheck"]["reason"], "UPSTREAM_API_UNVERIFIED")
        json.dumps(result, allow_nan=False)


if __name__ == "__main__":
    unittest.main()
