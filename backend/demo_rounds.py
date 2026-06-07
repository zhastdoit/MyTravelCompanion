"""Drive the live agent server through a 3-round conversation and print, per round:
what the agents did (the handoff trail), how many LLM calls, and token + $ usage.

Prereq: the server is running ->  uvicorn main:app --port 8000
Run:    python demo_rounds.py            # real or mock, whatever the server is in
        BASE=http://127.0.0.1:8000 python demo_rounds.py
"""
import json
import os
import urllib.request

BASE = os.getenv("BASE", "http://127.0.0.1:8000")
SID = os.getenv("SID", "demo-rounds")
USER = os.getenv("USER_NAME", "Charles")

ROUNDS = [
    ("Round 1 — group plans a trip (budget conflict $1200 vs $2000)",
     "Plan a trip from SFO to Tokyo. Two of us want $1200, one wants $2000. "
     "We love food and temples, relaxed pace."),
    ("Round 2 — live weather disruption",
     "Is the weather going to ruin our outdoor plans?"),
    ("Round 3 — @-mention an agent directly",
     "@Logistician pull cheaper flight options for us"),
]


def _post(path, body):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(),
                                 headers={"content-type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=120))


def ask(msg):
    return _post("/api/chat", {"session_id": SID, "user_name": USER, "message": msg})


def main():
    _post(f"/api/reset/{SID}", {})
    d = None
    for title, msg in ROUNDS:
        d = ask(msg)
        tt = d["tokens_turn"]
        print("=" * 80)
        print(title)
        print("-" * 80)
        for t in d["trail"]:
            r = ("  — " + t["result"][:60]) if t.get("result") else ""
            print(f"   {t['agent']:<12} {t['action']}{r}")
        print(f"   >> {tt['calls']} LLM calls | {tt['prompt']} in + {tt['completion']} out "
              f"= {tt['total']} tokens | session spent ${d['usd_spent']:.4f}")
        print("   REPLY:", (d["reply"] or "")[:100])
    ts = d["tokens_session"]
    print("=" * 80)
    print(f"TOTAL: {ts['total']} tokens ({ts['prompt']} in + {ts['completion']} out), "
          f"{ts['calls']} LLM calls, ${d['usd_spent']:.4f} / cap ${d['usd_cap']:.2f} "
          f"({d['llm_mode']} mode)")


if __name__ == "__main__":
    main()
