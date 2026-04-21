import os
from urllib.parse import quote

import streamlit as st
from dotenv import load_dotenv

from src.ats_grading import (
    SUPPORTED_EXTENSIONS,
    create_resume_docx_bytes,
    create_resume_pdf_bytes,
    create_resume_pdf_from_text_bytes,
    extract_resume_text,
    get_api_key,
    get_openrouter_client,
    llm_infer_target_roles,
    llm_optimize_resume,
    run_ats_pipeline,
    safe_truncate,
)
from src.job_scout import (
    get_smtp_config,
    prepare_job_notification,
    prepare_job_notification_for_role,
    run_job_notification,
    send_email,
    send_email_via_outlook,
    diagnose_outlook_com,
    smtp_is_configured,
)

PROJECT_NAME = "ResumeRise AI"


def render_ats_workflow(client):
    st.header("Resume Optimization & ATS Scoring")
    uploaded_file = st.file_uploader(
        "Upload resume for ATS optimization",
        type=[ext.lstrip(".") for ext in SUPPORTED_EXTENSIONS],
        help="Upload PDF, DOCX, DOC, or TXT resume files.",
        key="optimize_resume_upload",
    )
    job_description = st.text_area(
        "Paste the job description",
        height=240,
        key="optimize_job_description",
    )
    industry = st.text_input("Industry / Role Category", help="Optional category to improve recommendations.", key="optimize_industry")
    experience_level = st.selectbox(
        "Experience Level",
        ["", "Entry-Level (0-2 yrs)", "Mid-Level (2-5 yrs)", "Senior (5-10 yrs)", "Executive (10+ yrs)"],
        key="optimize_experience_level",
    )

    analyze_button = st.button("Analyze & Recommend", key="analyze_button")
    if analyze_button:
        if not uploaded_file:
            st.warning("Please upload a resume file first.")
            return
        if not job_description.strip():
            st.warning("Please provide a job description text.")
            return

        try:
            with st.spinner("Extracting resume text..."):
                full_resume_text = extract_resume_text(uploaded_file)
            resume_text_for_scoring = safe_truncate(full_resume_text)
            job_description_full = job_description
            job_description_for_scoring = safe_truncate(job_description_full)
            with st.spinner("Generating ATS score and recommendations..."):
                result = run_ats_pipeline(
                    resume_text_for_scoring,
                    job_description_for_scoring,
                    industry,
                    experience_level,
                    client,
                )
            st.session_state["ats_analysis"] = {
                "resume_text": full_resume_text,
                "job_description": job_description_full,
                "industry": industry,
                "experience_level": experience_level,
                "result": result,
            }
        except Exception as exc:
            st.error(f"Failed to analyze resume: {exc}")
            return

    analysis = st.session_state.get("ats_analysis")
    if analysis:
        result = analysis["result"]
        st.success("ATS analysis complete.")
        col1, col2 = st.columns(2)
        with col1:
            st.metric("ATS Score", f"{result['ATS_score']}/100")
            st.metric("Match Level", result["match_level"])
        with col2:
            st.metric("Parsability Score", f"{result['parsability_score']}/45")
            st.metric("Relevance Score", f"{result['relevance_score']}/55")

        with st.expander("How a standard ATS works (quick guide)"):
            st.markdown(
                """
A standard ATS does **not** “read” a resume like a human. It usually **parses**, **matches**, and **ranks** it.

## Core rules of a standard ATS

### 1) Keyword matching

The ATS looks for words and phrases from the job description in your resume.
Example: if the JD says **Python, SQL, Data Analysis**, those exact terms help more than vague phrases like “coding” or “analytics.”

### 2) Exact phrase preference

Many ATS tools give stronger weight to exact matches than synonyms.
Example: **“Machine Learning”** may score better than just **“AI”**, unless both are present.

### 3) Section recognition

The ATS tries to identify sections like:

* Summary
* Experience
* Skills
* Education

Clear headings help the system understand your resume structure.

### 4) Formatting simplicity

ATS works best with simple, plain formatting.
It can struggle with:

* tables
* columns
* text boxes
* icons
* images
* complex designs

### 5) File parsing

The ATS must extract text correctly from your file.
A resume that looks nice but is hard to parse can lose points because the system cannot “see” the content properly.

### 6) Job title relevance

ATS often checks whether your past roles or target title are close to the job title.
Example: **Data Analyst**, **Business Analyst**, and **Reporting Analyst** may not be treated as identical.

### 7) Skill coverage

It checks whether your resume contains the required tools, technologies, and competencies.
Example: **Python, Pandas, SQL, Power BI, Excel**.

### 8) Experience relevance

It looks at whether your experience matches the role scope.
A project in your resume helps more if it shows the same kind of work the job asks for.

### 9) Recency and frequency

Important keywords repeated naturally in recent experience tend to matter more than a keyword mentioned once in a side note.

### 10) Consistency and truthfulness

A strong ATS resume should include keywords only where they are truthful.
If you add skills you do not actually have, the ATS may pass you through, but the interview stage will expose it.

## In simple words

A standard ATS mostly asks:

* “Do I see the right keywords?”
* “Can I parse this resume cleanly?”
* “Does this person look relevant for the role?”

## Best mental model

Think of ATS as a **filtering engine**, not a judge of talent.
It mainly decides: **pass / not pass / rank higher / rank lower**.

If you want, I can turn this into a **very simple ATS flowchart** or a **resume checklist** you can use before applying.
"""
            )

        st.markdown("#### Target role and recommendation")
        st.write(f"**Best fit role:** {result.get('role_title', 'N/A')}")
        st.write(f"**Suggested roles:** {', '.join(result.get('target_roles', []))}")

        with st.expander("Recommendations"):
            recommendations = result.get("recommendations", [])
            if recommendations:
                for rec in recommendations:
                    st.write(f"- {rec}")
            else:
                st.write("No recommendations were returned (likely an LLM extraction issue). Try again or switch the model.")

        st.markdown("#### Missing keywords")
        jd_total = int(result.get("jd_keywords_total") or 0)
        missing = result.get("missing_keywords") or []
        if jd_total == 0:
            st.write("No JD keywords were extracted, so keyword match cannot be computed.")
        else:
            st.write(", ".join(missing) if missing else "All keywords matched!")

        with st.expander("ATS scoring rubric"):
            rubric = result.get("ats_rubric")
            st.write(rubric if rubric else "No rubric was returned.")

        optimize_button = st.button("AI Optimize Resume", key="optimize_button")
        if optimize_button:
            try:
                with st.spinner("Optimizing resume..."):
                    optimized_text = llm_optimize_resume(
                        analysis["resume_text"],
                        analysis["job_description"],
                        result.get("recommendations", []),
                        result.get("ats_rubric", {}),
                        result.get("missing_keywords", []),
                        client,
                    )
                    st.session_state["optimized_resume_text"] = optimized_text

                with st.spinner("Scoring optimized resume..."):
                    optimized_result = run_ats_pipeline(
                        safe_truncate(optimized_text),
                        safe_truncate(analysis["job_description"]),
                        analysis.get("industry", ""),
                        analysis.get("experience_level", ""),
                        client,
                        jd_keywords_override=(analysis.get("result", {}) or {}).get("jd_keywords", []),
                    )
                    st.session_state["optimized_ats_result"] = optimized_result
            except Exception as exc:
                st.error(f"Resume optimization failed: {exc}")

        if st.session_state.get("optimized_resume_text"):
            optimized_resume_text = st.session_state["optimized_resume_text"]
            st.markdown("### Optimized Resume")
            st.text_area("Optimized resume text", optimized_resume_text, height=320)

            docx_bytes = create_resume_docx_bytes(optimized_resume_text)
            st.download_button(
                "Download optimized resume (.docx)",
                data=docx_bytes,
                file_name="optimized_resume.docx",
                mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
            try:
                pdf_bytes = create_resume_pdf_bytes(docx_bytes)
                st.download_button(
                    "Download optimized resume (.pdf)",
                    data=pdf_bytes,
                    file_name="optimized_resume.pdf",
                    mime="application/pdf",
                )
            except Exception as exc:
                try:
                    pdf_bytes = create_resume_pdf_from_text_bytes(optimized_resume_text)
                    st.download_button(
                        "Download optimized resume (.pdf)",
                        data=pdf_bytes,
                        file_name="optimized_resume.pdf",
                        mime="application/pdf",
                    )
                    st.info("PDF generated via built-in text export (fallback).")
                except Exception as exc2:
                    st.warning(f"PDF export unavailable: {exc} | Fallback failed: {exc2}")

            optimized_result = st.session_state.get("optimized_ats_result")
            if optimized_result:
                st.markdown("### Optimized Resume ATS Score")
                col1o, col2o = st.columns(2)
                with col1o:
                    st.metric("Optimized ATS Score", f"{optimized_result['ATS_score']}/100")
                    st.metric("Match Level", optimized_result["match_level"])
                with col2o:
                    st.metric("Parsability Score", f"{optimized_result['parsability_score']}/45")
                    st.metric("Relevance Score", f"{optimized_result['relevance_score']}/55")


def render_job_notification_workflow_advanced(client):
    st.warning("Advanced SMTP mode is deprecated. Use the simplified Job Discovery workflow below.")
    return
    st.header("Job Discovery & Notifications")
    uploaded_file = st.file_uploader(
        "Upload resume for job discovery",
        type=[ext.lstrip(".") for ext in SUPPORTED_EXTENSIONS],
        help="Upload the resume file to infer roles and search fresh job postings.",
        key="job_search_resume_upload",
    )
    email_to = st.text_input("Email address to receive jobs", key="notification_email")
    smtp_host = st.text_input("SMTP host", value=os.getenv("SMTP_HOST", ""), key="smtp_host")
    smtp_port = st.text_input("SMTP port", value=os.getenv("SMTP_PORT", "587"), key="smtp_port")
    smtp_username = st.text_input("SMTP username", value=os.getenv("SMTP_USERNAME", ""), key="smtp_username")
    smtp_password = st.text_input("SMTP password", type="password", value=os.getenv("SMTP_PASSWORD", ""), key="smtp_password")
    from_email = st.text_input("Email from address", value=os.getenv("EMAIL_FROM", smtp_username or ""), key="from_email")
    use_ssl = st.checkbox("Use SSL for SMTP", value=False, key="smtp_use_ssl")

    run_search = st.button("Search Latest Jobs & Send Email", key="run_job_search")
    if run_search:
        if not uploaded_file:
            st.warning("Please upload your resume file.")
            return
        if not email_to.strip():
            st.warning("Please provide a destination email address.")
            return

        try:
            with st.spinner("Reading resume and inferring roles..."):
                resume_text = extract_resume_text(uploaded_file)
            resume_text = safe_truncate(resume_text)
            roles = llm_infer_target_roles(resume_text, client)
            target_role = roles.get("best_role") or (roles.get("target_roles") or [None])[0]

            if not target_role:
                st.error("Unable to infer a target role from the resume.")
                return

            with st.spinner(f"Searching jobs for {target_role}..."):
                job_results = search_jobs_for_role(target_role)

            st.success(f"Found job postings for {target_role}.")
            if job_results:
                for site_result in job_results:
                    st.subheader(site_result["site"])
                    for job in site_result["jobs"]:
                        st.markdown(f"- [{job['title']}]({job['link']}) — {job['company']} • {job['location']}")
            else:
                st.info("No fresh job postings were found for this role in the last 24 hours.")

            email_body = [
                f"Hello,\n\nHere are the latest job openings for: {target_role}",
                "",
            ]
            for site_result in job_results:
                email_body.append(f"=== {site_result['site']} ===")
                for job in site_result["jobs"]:
                    email_body.append(f"- {job['title']} — {job['company']} • {job['location']}\n  {job['link']}")

            email_body.append("\nRegards,\nResumeRise AI Job Discovery")
            email_text = "\n".join(email_body)

            smtp_config = get_smtp_config(smtp_host, smtp_port, smtp_username, smtp_password, from_email, use_ssl)
            try:
                with st.spinner("Sending job notification email..."):
                    send_email(email_to, f"Job Alerts for {target_role}", email_text, smtp_config)
                st.success(f"Email sent to {email_to}.")
            except Exception as exc:
                st.error(f"Unable to send email: {exc}")
                st.markdown("Please verify SMTP settings or the email credentials.")
        except Exception as exc:
            st.error(f"Job discovery workflow failed: {exc}")


def render_job_notification_workflow(client):
    st.header("Job Discovery & Notifications")
    uploaded_file = st.file_uploader(
        "Upload resume for job discovery",
        type=[ext.lstrip(".") for ext in SUPPORTED_EXTENSIONS],
        help="Upload the resume file to infer roles and generate job alerts for you.",
        key="job_search_resume_upload_simple",
    )
    email_to = st.text_input("Email address to receive jobs", key="notification_email_simple")
    role_override = st.text_input(
        "Target role (optional)",
        help="If role inference fails due to network issues, enter a role like 'Data Analyst' or 'ML Engineer'.",
        key="target_role_override",
    )
    st.caption("Enter your email to receive job alerts. If auto-send isn't available, you'll get a ready-to-send email draft.")

    run_search = st.button("Search Latest Jobs & Send Email", key="run_job_search_simple")
    if not run_search:
        return

    if not uploaded_file:
        st.warning("Please upload your resume file.")
        return
    if not email_to.strip():
        st.warning("Please provide a destination email address.")
        return

    try:
        with st.spinner("Reading resume..."):
            resume_text = extract_resume_text(uploaded_file)
        resume_text = safe_truncate(resume_text)

        with st.spinner("Finding jobs..."):
            if role_override.strip():
                target_role, job_results, subject, email_text = prepare_job_notification_for_role(role_override)
            else:
                target_role, job_results, subject, email_text = prepare_job_notification(resume_text, client)

        st.markdown("#### Job results (JSON)")
        st.json(job_results)

        smtp_config = get_smtp_config("", "", "", "", "", False)
        email_sent = False

        # 1) Try SMTP if configured
        if smtp_is_configured(smtp_config):
            try:
                with st.spinner("Sending email..."):
                    send_email(email_to, subject, email_text, smtp_config)
                st.success(f"Email sent to {email_to} for: {target_role}.")
                email_sent = True
            except Exception as exc:
                st.warning(f"SMTP send failed: {exc}")

        # 2) Try Outlook (no SMTP credentials required in the UI)
        if not email_sent:
            try:
                with st.spinner("Sending email via Outlook..."):
                    send_email_via_outlook(email_to, subject, email_text)
                st.success(f"Email sent to {email_to} for: {target_role}.")
                st.caption("Sent via local Outlook profile.")
                email_sent = True
            except Exception as exc:
                st.warning("Unable to auto-send via Outlook on this machine.")
                st.caption(str(exc))
                with st.expander("Outlook diagnostics"):
                    st.json(diagnose_outlook_com())

        # 3) Final fallback: draft for the user's email app
        if not email_sent:
            st.info("Email draft is ready. Send it from your email app.")
            max_mailto_chars = 1800
            mailto_body = email_text if len(email_text) <= max_mailto_chars else (email_text[:max_mailto_chars] + "\n\n[...truncated...]")
            mailto_url = f"mailto:{email_to}?subject={quote(subject)}&body={quote(mailto_body)}"
            st.markdown(f"[Open email draft]({mailto_url})")
            st.download_button(
                "Download email text (.txt)",
                data=email_text.encode("utf-8"),
                file_name="job_alerts_email.txt",
                mime="text/plain",
            )
            st.text_area("Email draft", email_text, height=260)

        if not job_results:
            st.info("No fresh job postings were found in the configured sources.")
    except Exception as exc:
        st.error(f"Job discovery workflow failed: {exc}")
        error_text = str(exc)
        if "getaddrinfo failed" in error_text:
            st.info("This looks like a DNS/network issue. Enter a `Target role` manually and retry, or fix internet/DNS access.")
        st.info("If you want auto-send (optional), configure SMTP in `.env`.")


def main():
    st.set_page_config(
        page_title=PROJECT_NAME,
        page_icon="🤖",
        layout="wide",
    )

    st.title(PROJECT_NAME)
    st.markdown(
        "AI-powered resume optimization and job discovery platform for ATS scoring, resume enhancement, and daily job notifications."
    )
    st.markdown(
        "Choose a workflow below to get started."
    )

    api_key = get_api_key()
    if not api_key:
        st.error(
            "API key not found. Please add OPENROUTER_API_KEY to your .env file or environment variables."
        )
        st.stop()

    client = get_openrouter_client()

    # Initialize workflow selection
    if "workflow" not in st.session_state:
        st.session_state["workflow"] = None

    # Create two columns for buttons
    col1, col2 = st.columns(2)

    with col1:
        if st.button("🚀 ATS Optimization & Scoring", use_container_width=True):
            st.session_state["workflow"] = "ats"

    with col2:
        if st.button("🔍 Job Discovery & Notifications", use_container_width=True):
            st.session_state["workflow"] = "job"

    # Render selected workflow
    workflow = st.session_state["workflow"]
    if workflow == "ats":
        render_ats_workflow(client)
    elif workflow == "job":
        render_job_notification_workflow(client)
    else:
        st.info("Select a workflow above to begin.")


if __name__ == "__main__":
    main()
