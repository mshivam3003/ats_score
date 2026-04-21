import json
import os
import re
import smtplib
import sys
from datetime import date
from email.message import EmailMessage
from pathlib import Path
from urllib.parse import quote_plus, urlsplit, urlunsplit

import requests
from dotenv import load_dotenv
from lxml import html

JOB_SITES_FILE = Path(__file__).resolve().parent.parent / "job_sites.json"
JOB_DETAILS_MAX = int(os.getenv("JOB_DETAILS_MAX", "4") or 4)
JOB_DETAILS_TIMEOUT_S = int(os.getenv("JOB_DETAILS_TIMEOUT_S", "10") or 10)


def load_job_sites():
    if not JOB_SITES_FILE.exists():
        return []

    # Windows editors sometimes write UTF-8 with BOM; json.loads will choke on the BOM.
    with open(JOB_SITES_FILE, "r", encoding="utf-8-sig") as f:
        return json.load(f)


def build_job_search_headers():
    return {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36"
    }


def _normalize_url(url: str) -> str:
    url = (url or "").strip()
    if not url:
        return ""
    parts = urlsplit(url)
    # Drop query/fragment to improve matching against JSON-LD urls.
    return urlunsplit((parts.scheme, parts.netloc, parts.path, "", "")).rstrip("/")


def _to_location_string(location_payload) -> str:
    if not location_payload:
        return ""

    if isinstance(location_payload, str):
        return location_payload.strip()

    if isinstance(location_payload, list):
        rendered = [_to_location_string(item) for item in location_payload]
        rendered = [item for item in rendered if item]
        return " | ".join(rendered)

    if isinstance(location_payload, dict):
        # schema.org JobPosting can have jobLocation as Place with address
        address = location_payload.get("address")
        if isinstance(address, dict):
            locality = (address.get("addressLocality") or "").strip()
            region = (address.get("addressRegion") or "").strip()
            country = (address.get("addressCountry") or "").strip()
            postal = (address.get("postalCode") or "").strip()
            parts = [locality, region, country]
            parts = [p for p in parts if p]
            if postal:
                parts.append(postal)
            return ", ".join(parts).strip(", ").strip()

        name = (location_payload.get("name") or "").strip()
        if name:
            return name

    return ""


def _extract_jobpostings_from_jsonld(tree) -> list[dict]:
    """
    Best-effort extraction of schema.org JobPosting data from JSON-LD blocks.
    Returns list of dicts with: url, title, company, location.
    """
    postings: list[dict] = []
    for node in tree.xpath("//script[@type='application/ld+json']"):
        raw = (node.text or "").strip()
        if not raw:
            continue
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            continue

        stack = [payload]
        while stack:
            current = stack.pop()
            if isinstance(current, list):
                stack.extend(current)
                continue
            if not isinstance(current, dict):
                continue

            typ = current.get("@type")
            if typ == "JobPosting":
                url = current.get("url") or current.get("@id") or ""
                title = (current.get("title") or "").strip()
                org = current.get("hiringOrganization") or {}
                company = ""
                if isinstance(org, dict):
                    company = (org.get("name") or "").strip()
                location = _to_location_string(current.get("jobLocation"))
                if not location:
                    location = (current.get("jobLocationType") or "").strip()
                postings.append(
                    {
                        "url": _normalize_url(url),
                        "title": title,
                        "company": company,
                        "location": location,
                    }
                )
                continue

            # Common JSON-LD container shape: {"@graph":[...]}
            graph = current.get("@graph")
            if graph is not None:
                stack.append(graph)

    return postings


def _extract_company_location_from_context(anchor) -> tuple[str, str]:
    """
    Heuristic extraction from nearby DOM (works for some static HTML job boards).
    """
    def _match_first_text(nodes) -> str:
        for item in nodes:
            text = (item or "").strip()
            if text:
                return text
        return ""

    node = anchor
    for _depth in range(5):
        if node is None:
            break

        company = _match_first_text(
            node.xpath(".//*[contains(translate(@class,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'company')]/text()")
            + node.xpath(".//*[contains(translate(@id,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'company')]/text()")
            + node.xpath(".//*[contains(translate(@class,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'employer')]/text()")
        )
        location = _match_first_text(
            node.xpath(".//*[contains(translate(@class,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'location')]/text()")
            + node.xpath(".//*[contains(translate(@id,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'location')]/text()")
        )

        company = company.strip()
        location = location.strip()
        if company or location:
            return company, location

        node = node.getparent()

    return "", ""


def _fetch_job_detail_jsonld(job_url: str) -> dict | None:
    job_url = (job_url or "").strip()
    if not job_url:
        return None

    try:
        response = requests.get(job_url, headers=build_job_search_headers(), timeout=JOB_DETAILS_TIMEOUT_S)
        response.raise_for_status()
    except requests.RequestException:
        return None

    try:
        tree = html.fromstring(response.text)
    except Exception:
        return None

    postings = _extract_jobpostings_from_jsonld(tree)
    if not postings:
        return None

    normalized_url = _normalize_url(job_url)
    for posting in postings:
        if posting.get("url") and normalized_url and posting["url"] == normalized_url:
            return posting

    # Otherwise pick the first JobPosting.
    return postings[0]


def _enrich_jobs_with_details(jobs: list[dict]) -> list[dict]:
    if not jobs:
        return jobs

    remaining = max(0, JOB_DETAILS_MAX)
    if remaining == 0:
        return jobs

    for job in jobs:
        if remaining <= 0:
            break
        if (job.get("company") and job["company"] != "Unknown") and (job.get("location") and job["location"] != "Unknown"):
            continue

        posting = _fetch_job_detail_jsonld(job.get("link", ""))
        if not posting:
            continue

        company = (posting.get("company") or "").strip()
        location = (posting.get("location") or "").strip()
        if company:
            job["company"] = company
        if location:
            job["location"] = location

        remaining -= 1

    return jobs


def search_jobs_from_site(site: dict, role_query: str) -> list[dict]:
    search_url = site.get("search_url")
    if search_url:
        search_url = search_url.format(query=quote_plus(role_query))
    elif site.get("link"):
        base_link = site["link"].rstrip("/")
        search_url = f"{base_link}/search?q={quote_plus(role_query)}"
    else:
        return []

    try:
        response = requests.get(search_url, headers=build_job_search_headers(), timeout=12)
        response.raise_for_status()
    except requests.RequestException:
        return []

    tree = html.fromstring(response.text)
    postings = _extract_jobpostings_from_jsonld(tree)
    postings_by_url = {p["url"]: p for p in postings if p.get("url")}
    postings_by_title = {p["title"].lower(): p for p in postings if p.get("title")}
    results = []
    seen_urls = set()

    anchors = tree.xpath("//a[@href]")
    for anchor in anchors:
        title = " ".join(anchor.xpath(".//text()")).strip()
        href = anchor.get("href", "").strip()
        if not title or not href:
            continue
        if len(title) < 20:
            continue
        if re.search(r"\b(job|career|position)\b", title, re.I) is None and re.search(r"\b(job|career|position)\b", href, re.I) is None:
            continue
        if role_query.lower().split()[0] not in title.lower() and role_query.lower() not in title.lower():
            continue
        if href.startswith("/"):
            base_url = site.get("base_url", "")
            href = base_url.rstrip("/") + href

        normalized_href = _normalize_url(href)
        if href in seen_urls:
            continue
        seen_urls.add(href)

        company = ""
        location = ""
        if normalized_href and normalized_href in postings_by_url:
            company = postings_by_url[normalized_href].get("company", "") or ""
            location = postings_by_url[normalized_href].get("location", "") or ""
        elif title.lower() in postings_by_title:
            company = postings_by_title[title.lower()].get("company", "") or ""
            location = postings_by_title[title.lower()].get("location", "") or ""

        if not company or not location:
            ctx_company, ctx_location = _extract_company_location_from_context(anchor)
            company = company or ctx_company
            location = location or ctx_location

        results.append({
            "title": title,
            "role": role_query,
            "company": company or "Unknown",
            "location": location or "Unknown",
            "link": href,
        })
        if len(results) >= 10:
            break

    return _enrich_jobs_with_details(results)


def search_jobs_for_role(role_query: str) -> list[dict]:
    sites = load_job_sites()
    all_results = []
    for site in sites:
        jobs = search_jobs_from_site(site, role_query)
        if jobs:
            all_results.append({"site": site["name"], "role": role_query, "jobs": jobs})
    return all_results


def get_smtp_config(smtp_host: str, smtp_port: str, smtp_username: str, smtp_password: str, from_email: str, use_ssl: bool):
    load_dotenv()
    return {
        "smtp_host": smtp_host or os.getenv("SMTP_HOST", ""),
        "smtp_port": int(smtp_port or os.getenv("SMTP_PORT", "587")),
        "smtp_username": smtp_username or os.getenv("SMTP_USERNAME", ""),
        "smtp_password": smtp_password or os.getenv("SMTP_PASSWORD", ""),
        "from_email": from_email or os.getenv("EMAIL_FROM", smtp_username or ""),
        "use_ssl": use_ssl,
    }


def send_email(recipient: str, subject: str, body: str, smtp_config: dict):
    if not smtp_config["smtp_host"] or not smtp_config["smtp_username"] or not smtp_config["smtp_password"]:
        raise RuntimeError("Missing SMTP configuration. Set SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD and EMAIL_FROM.")

    message = EmailMessage()
    message["From"] = smtp_config["from_email"]
    message["To"] = recipient
    message["Subject"] = subject
    message.set_content(body)

    if smtp_config["smtp_port"] == 465 or smtp_config["use_ssl"]:
        server = smtplib.SMTP_SSL(smtp_config["smtp_host"], smtp_config["smtp_port"], timeout=15)
    else:
        server = smtplib.SMTP(smtp_config["smtp_host"], smtp_config["smtp_port"], timeout=15)
        server.starttls()

    try:
        server.login(smtp_config["smtp_username"], smtp_config["smtp_password"])
        server.send_message(message)
    finally:
        server.quit()


def send_email_via_outlook(recipient: str, subject: str, body: str):
    """
    Best-effort email sending using a locally configured Microsoft Outlook profile on Windows.
    This avoids asking end-users for SMTP details, but requires:
    - Windows
    - Outlook installed and signed in
    - `pywin32` installed (optional dependency)
    """
    try:
        import pythoncom  # type: ignore
        import win32com.client  # type: ignore
    except ImportError as exc:
        raise RuntimeError("Outlook send requires `pywin32` (pip install pywin32).") from exc

    pythoncom.CoInitialize()
    try:
        prog_ids = [
            "Outlook.Application",
            "Outlook.Application.16",
            "Outlook.Application.15",
            "Outlook.Application.14",
        ]

        outlook = None

        # Prefer an existing running instance if available.
        try:
            outlook = win32com.client.GetActiveObject("Outlook.Application")
        except Exception:
            outlook = None

        # Try to create a new instance using known ProgIDs.
        if outlook is None:
            last_exc: Exception | None = None
            for prog_id in prog_ids:
                try:
                    try:
                        outlook = win32com.client.gencache.EnsureDispatch(prog_id)
                    except Exception:
                        outlook = win32com.client.Dispatch(prog_id)
                    break
                except Exception as exc:
                    last_exc = exc
                    outlook = None

            if outlook is None and last_exc is not None:
                raise last_exc

        mail = outlook.CreateItem(0)
        mail.To = recipient
        mail.Subject = subject
        mail.Body = body
        mail.Send()
    except Exception as exc:
        # -2147221005 == "Invalid class string" (COM class not registered)
        # This usually means Outlook desktop isn't installed or registered for COM automation.
        if "-2147221005" in str(exc) or "Invalid class string" in str(exc):
            raise RuntimeError(
                "Outlook auto-send is unavailable because the Outlook desktop COM component isn't registered.\n"
                "Common causes:\n"
                "- You have the 'new Outlook' app (does not expose Outlook COM automation).\n"
                "- Outlook desktop isn't installed (Microsoft 365/Office classic Outlook).\n"
                "- Outlook COM registration is broken.\n\n"
                "Fix options:\n"
                "1) Install/launch classic Outlook desktop (Microsoft 365 Apps), sign in, close it, then restart this app.\n"
                "2) Run `outlook.exe /regserver` from an elevated terminal, then restart.\n"
                f"Python: {sys.executable}"
            ) from exc
        raise
    finally:
        try:
            pythoncom.CoUninitialize()
        except Exception:
            pass


def diagnose_outlook_com() -> dict:
    """
    Returns basic info to debug Outlook COM availability (best-effort).
    """
    info = {
        "python": sys.executable,
        "python_version": sys.version,
        "outlook_progid_registered": False,
        "outlook_clsid": None,
        "outlook_localserver32": None,
    }

    try:
        import winreg  # type: ignore

        with winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, r"Outlook.Application\\CLSID") as key:
            clsid, _ = winreg.QueryValueEx(key, "")
            info["outlook_progid_registered"] = True
            info["outlook_clsid"] = clsid

        if info["outlook_clsid"]:
            with winreg.OpenKey(
                winreg.HKEY_CLASSES_ROOT,
                rf"CLSID\\{info['outlook_clsid']}\\LocalServer32",
            ) as key:
                server_path, _ = winreg.QueryValueEx(key, "")
                info["outlook_localserver32"] = server_path
    except Exception:
        # If any registry access fails, return partial info.
        pass

    return info


def strip_emojis(text: str) -> str:
    if not text:
        return ""

    # Remove most common emoji / pictograph ranges + variation selectors.
    emoji_pattern = re.compile(
        "["
        "\U0001F1E6-\U0001F1FF"  # flags
        "\U0001F300-\U0001F5FF"  # symbols & pictographs
        "\U0001F600-\U0001F64F"  # emoticons
        "\U0001F680-\U0001F6FF"  # transport & map symbols
        "\U0001F700-\U0001F77F"  # alchemical symbols
        "\U0001F780-\U0001F7FF"  # geometric shapes extended
        "\U0001F800-\U0001F8FF"  # supplemental arrows-c
        "\U0001F900-\U0001F9FF"  # supplemental symbols and pictographs
        "\U0001FA00-\U0001FAFF"  # symbols and pictographs extended-a
        "\u2600-\u26FF"          # misc symbols
        "\u2700-\u27BF"          # dingbats
        "\uFE0E-\uFE0F"          # variation selectors
        "\u200D"                 # zero-width joiner
        "]+",
        flags=re.UNICODE,
    )
    return emoji_pattern.sub("", text)


def _sanitize_email_field(text: str) -> str:
    text = strip_emojis(text or "")
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"[!]{2,}", "!", text)

    # Keep the email non-promotional by removing common hype phrases that sometimes appear in scraped titles.
    removals = [
        r"\bapply now\b",
        r"\burgently hiring\b",
        r"\bhiring now\b",
        r"\bimmediate joiner\b",
        r"\blimited time\b",
        r"\bhot job\b",
    ]
    for pattern in removals:
        text = re.sub(pattern, "", text, flags=re.IGNORECASE).strip()
        text = re.sub(r"\s+", " ", text).strip()

    return text


def build_job_email_subject(target_role: str, as_of: date | None = None) -> str:
    as_of = as_of or date.today()
    target_role = _sanitize_email_field(target_role)
    return f"Jobs - {target_role} - {as_of.isoformat()}"


def build_job_email_body(target_role: str, job_results: list[dict]) -> str:
    """
    Draft a simple, non-promotional email body.

    Includes only: job title, role, link, company name, date, platform name.
    """
    as_of = date.today().isoformat()
    target_role = _sanitize_email_field(target_role)
    parts = [f"Role: {target_role}", f"Date: {as_of}", ""]
    if not job_results:
        parts.append("No matching jobs were found.")
    else:
        item_no = 0
        for site_result in job_results:
            site_name = _sanitize_email_field(str(site_result.get("site", ""))) or "Unknown"
            for job in site_result.get("jobs", []):
                item_no += 1
                title = _sanitize_email_field(str(job.get("title", ""))) or "Untitled"
                company = _sanitize_email_field(str(job.get("company", ""))) or "Unknown"
                link = (str(job.get("link", "")) or "").strip()

                parts.extend(
                    [
                        f"{item_no}.",
                        f"Platform: {site_name}",
                        f"Role: {target_role}",
                        f"Company: {company}",
                        f"Job: {title}",
                        f"Date: {as_of}",
                        f"Link: {link}",
                        "",
                    ]
                )
    return "\n".join(parts)


def smtp_is_configured(smtp_config: dict) -> bool:
    return bool(
        smtp_config.get("smtp_host")
        and smtp_config.get("smtp_port")
        and smtp_config.get("smtp_username")
        and smtp_config.get("smtp_password")
        and smtp_config.get("from_email")
    )


def prepare_job_notification_for_role(target_role: str):
    target_role = (target_role or "").strip()
    if not target_role:
        raise ValueError("Target role is required.")

    job_results = search_jobs_for_role(target_role)
    email_text = build_job_email_body(target_role, job_results)
    subject = build_job_email_subject(target_role)
    return target_role, job_results, subject, email_text


def prepare_job_notification(resume_text: str, client):
    if not resume_text.strip():
        raise ValueError("Resume text is required for job discovery.")

    from src.ats_grading import llm_infer_target_roles

    try:
        roles = llm_infer_target_roles(resume_text, client)
    except Exception as exc:
        raise RuntimeError(
            "Unable to infer target role (LLM/network error). Provide a target role manually and retry."
        ) from exc

    target_role = roles.get("best_role") or (roles.get("target_roles") or [None])[0]
    if not target_role:
        raise ValueError("Unable to infer a target role from the resume.")

    return prepare_job_notification_for_role(target_role)


def run_job_notification(resume_text: str, email_to: str, smtp_config: dict, client):
    target_role, job_results, subject, email_text = prepare_job_notification(resume_text, client)
    send_email(email_to, subject, email_text, smtp_config)
    return target_role, job_results
