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
    get_ai_client,
    make_chat_completion,
    llm_infer_target_roles,
    llm_optimize_resume,
    run_ats_pipeline,
    safe_truncate,
)
from src.job_scout import (
    build_job_email_body,
    build_job_email_subject,
    get_smtp_config,
    prepare_job_notification,
    prepare_job_notification_for_role,
    run_job_notification,
    send_email,
    send_email_via_outlook,
    test_smtp_connection,
    diagnose_outlook_com,
    smtp_is_configured,
)

PROJECT_NAME = "ResumeRise AI"


def active_smtp_config():
    return st.session_state.get("email_account") or get_smtp_config("", "", "", "", "", False)


def render_email_setup():
    st.markdown("""<div class="page-heading"><div class="eyebrow">ACCOUNT SETTINGS</div>
    <h2>Email account setup</h2><p>Connect an SMTP sending account for job alerts and recruiter outreach.</p></div>""", unsafe_allow_html=True)
    st.info("Your SMTP credentials are held in this Streamlit session only. They are not written to .env or sent to the AI model.")
    st.markdown("For Gmail, use an [app password](https://support.google.com/accounts/answer/185833) with 2-Step Verification. Do not enter your normal Google password. OAuth inbox access is not part of this connection.")
    if "email_account" in st.session_state:
        st.markdown("<div class='action-row'><span class='action-dot'></span>SMTP account connected for this session</div>", unsafe_allow_html=True)
    elif smtp_is_configured(get_smtp_config("", "", "", "", "", False)):
        st.markdown("<div class='action-row'><span class='action-dot'></span>SMTP credentials are available from .env</div>", unsafe_allow_html=True)

    if st.button("Forget session email credentials", disabled="email_account" not in st.session_state):
        st.session_state.pop("email_account", None)
        for key in ("email_setup_host", "email_setup_port", "email_setup_username", "email_setup_password", "email_setup_from", "email_setup_ssl"):
            st.session_state.pop(key, None)
        st.rerun()

    defaults = st.session_state.get("email_account", {})
    st.session_state.setdefault("email_setup_host", defaults.get("smtp_host", "smtp.gmail.com"))
    st.session_state.setdefault("email_setup_port", int(defaults.get("smtp_port", 587)))
    st.session_state.setdefault("email_setup_username", defaults.get("smtp_username", ""))
    st.session_state.setdefault("email_setup_password", defaults.get("smtp_password", ""))
    st.session_state.setdefault("email_setup_from", defaults.get("from_email", ""))
    st.session_state.setdefault("email_setup_ssl", bool(defaults.get("use_ssl", False)))

    with st.form("email_account_setup"):
        left, right = st.columns(2)
        with left:
            host = st.text_input("SMTP server", key="email_setup_host", help="Gmail: smtp.gmail.com")
            port = st.number_input("SMTP port", min_value=1, max_value=65535, key="email_setup_port")
            username = st.text_input("Account email / username", key="email_setup_username")
        with right:
            password = st.text_input("App password or SMTP credential", type="password", key="email_setup_password")
            from_email = st.text_input("Sender address", key="email_setup_from", help="Defaults to your account email if left blank.")
            use_ssl = st.checkbox("Use implicit SSL/TLS (commonly port 465)", key="email_setup_ssl")
        save = st.form_submit_button("Save for this session", type="primary")
        test_and_save = st.form_submit_button("Test connection and save")

    if save or test_and_save:
        config = {
            "smtp_host": host.strip(),
            "smtp_port": int(port),
            "smtp_username": username.strip(),
            "smtp_password": password,
            "from_email": from_email.strip() or username.strip(),
            "use_ssl": use_ssl,
        }
        if not smtp_is_configured(config):
            st.error("Enter the SMTP server, account email, and app password before saving.")
        elif test_and_save:
            try:
                test_smtp_connection(config)
                st.session_state["email_account"] = config
                st.success("Connection verified. Credentials are active for this session.")
            except Exception as exc:
                st.error(f"Connection failed: {exc}")
                st.caption("Check the SMTP server, port, TLS option, username, and app password.")
        else:
            st.session_state["email_account"] = config
            st.success("Email account saved for this session.")


def render_home():
    st.markdown("""
    <section class="welcome-panel">
      <div class="eyebrow">YOUR CAREER WORKSPACE</div>
      <h1>Make your next move<br><span>with a clear plan.</span></h1>
      <p>Turn your experience into better applications. Review your fit, find relevant roles, and follow up with confidence.</p>
    </section>
    """, unsafe_allow_html=True)
    analysis = st.session_state.get("ats_analysis")
    jobs = st.session_state.get("job_results", [])
    applications = st.session_state.get("applications", [])
    resume_status = "Ready to tailor" if analysis else "Not added"
    leads = sum(len(x.get("jobs", [])) for x in jobs)
    a, b, c = st.columns(3)
    a.metric("Resume profile", resume_status)
    b.metric("Job leads", leads)
    c.metric("Applications", len(applications))
    st.markdown("### Your workspace")
    left, right = st.columns(2)
    with left:
        st.markdown("""
        <div class="workspace-card">
          <div class="card-kicker">01 / RESUME STUDIO</div>
          <h3>Make your experience clear.</h3>
          <p>See how your resume aligns to a role. Find the gaps, then create a focused version without inventing experience.</p>
          <div class="card-foot">ANALYZE / IMPROVE / EXPORT</div>
        </div>
        """, unsafe_allow_html=True)
        st.button("Open resume studio", use_container_width=True, on_click=st.session_state.update, args=({"page": "Resume studio"},))
    with right:
        st.markdown("""
        <div class="workspace-card card-dark">
          <div class="card-kicker">02 / OPPORTUNITY SCOUT</div>
          <h3>Find your next opportunity.</h3>
          <p>Search from a target title or let the assistant suggest roles based on your resume.</p>
          <div class="card-foot">SEARCH / REVIEW / FOLLOW UP</div>
        </div>
        """, unsafe_allow_html=True)
        st.button("Open job scout", use_container_width=True, on_click=st.session_state.update, args=({"page": "Job scout"},))
    st.markdown("### Next actions")
    suggestions = []
    if not analysis:
        suggestions.append("Add your resume and a job description in Resume Studio to get a role-specific plan.")
    else:
        suggestions.append(f"Review the {analysis['result'].get('match_level', 'latest')} match and address the missing keywords before applying.")
    if not jobs:
        suggestions.append("Run Job Scout to collect leads and prepare a job alert email.")
    suggestions.extend(["Draft a concise recruiter introduction in Mail Room.", "Track applications in Application Tracker."])
    for item in suggestions:
        st.markdown(f"<div class='action-row'><span class='action-dot'></span>{item}</div>", unsafe_allow_html=True)

def render_mail_room(client):
    st.markdown("""<div class="page-heading"><div class="eyebrow">OUTREACH WORKSPACE</div>
    <h2>Mail room</h2><p>Write thoughtful outreach and send it through your configured email account.</p></div>""", unsafe_allow_html=True)
    if "mail_drafts" not in st.session_state:
        st.session_state["mail_drafts"] = []
    if st.button("Draft recruiter introduction with AI", disabled=client is None or not st.session_state.get("ats_analysis")):
        profile = st.session_state.get("ats_analysis", {})
        resume = profile.get("resume_text", "")
        role = (profile.get("result") or {}).get("role_title", "your target role")
        try:
            prompt = ("Write a concise recruiter outreach email using only facts in this resume; do not invent skills or results. "
                      "Put Subject: ... on the first line.\nTarget role: " + role + "\nResume:\n" + safe_truncate(resume, 7000))
            response = make_chat_completion(client, prompt, temperature=0.35, max_tokens=500)
            lines = (response.choices[0].message.content or "").splitlines()
            if lines and lines[0].lower().startswith("subject:"):
                st.session_state["mail_subject"] = lines.pop(0).split(":", 1)[1].strip()
            st.session_state["mail_body"] = "\n".join(lines).strip()
            st.rerun()
        except Exception as exc:
            st.error(f"Email draft failed: {exc}")
    with st.form("mail_compose"):
        address_col, subject_col = st.columns(2)
        to = address_col.text_input("To", key="mail_to")
        subject = subject_col.text_input("Subject", key="mail_subject")
        body = st.text_area("Message", height=240, key="mail_body")
        col1, col2 = st.columns(2)
        save = col1.form_submit_button("Save draft")
        send = col2.form_submit_button("Send email", type="primary")
    if save:
        st.session_state["mail_drafts"].append({"to": to, "subject": subject, "body": body})
        st.success("Draft saved in this session.")
    if send:
        if not to.strip() or not subject.strip() or not body.strip():
            st.error("Add a recipient, subject, and message before sending.")
        else:
            cfg = active_smtp_config()
            try:
                if smtp_is_configured(cfg):
                    send_email(to, subject, body, cfg)
                    st.success(f"Email sent to {to}.")
                else:
                    send_email_via_outlook(to, subject, body)
                    st.success(f"Email sent to {to} through Outlook.")
            except Exception as exc:
                st.error(f"Could not send email: {exc}")
                st.caption("Configure SMTP in .env or sign in to Outlook on this computer.")
    drafts = st.session_state.get("mail_drafts", [])
    if drafts:
        with st.expander(f"Saved drafts ({len(drafts)})"):
            for index, draft in enumerate(reversed(drafts), 1):
                st.markdown(f"**{index}. {draft['subject'] or '(No subject)'}** · {draft['to'] or 'No recipient'}")
                st.caption(draft["body"][:250])


def render_application_tracker():
    st.markdown("""<div class="page-heading"><div class="eyebrow">YOUR PIPELINE</div>
    <h2>Application tracker</h2><p>Keep target roles and application status together in one clear view.</p></div>""", unsafe_allow_html=True)
    if "applications" not in st.session_state:
        st.session_state["applications"] = []
    with st.form("add_application"):
        col1, col2, col3 = st.columns(3)
        company = col1.text_input("Company")
        role = col2.text_input("Role")
        status = col3.selectbox("Status", ["Interested", "Applied", "Interview", "Offer", "Closed"])
        link = st.text_input("Job link (optional)")
        add = st.form_submit_button("Add application")
    if add:
        if company.strip() and role.strip():
            st.session_state["applications"].append({"company": company.strip(), "role": role.strip(), "status": status, "link": link.strip()})
            st.success("Application added.")
        else:
            st.warning("Company and role are required.")
    entries = st.session_state["applications"]
    if entries:
        for idx, item in enumerate(entries):
            cols = st.columns([2, 2, 1, 2, 1])
            cols[0].write(item["company"])
            cols[1].write(item["role"])
            cols[2].write(item["status"])
            if item["link"]:
                cols[3].markdown(f"[Open listing]({item['link']})")
            if cols[4].button("Remove", key=f"remove_app_{idx}"):
                entries.pop(idx)
                st.rerun()
    else:
        st.info("No applications yet. Add a role above to start your pipeline.")


def render_ats_workflow(client):
    st.markdown("""<div class="page-heading"><div class="eyebrow">01 / RESUME STUDIO</div>
    <h2>Tailor your resume to the role</h2><p>Compare your experience with a job description, understand the gaps, and export a focused draft.</p></div>""", unsafe_allow_html=True)
    left_input, right_input = st.columns([0.85, 1.15])
    with left_input:
        st.markdown("#### 1. Add your resume")
        uploaded_file = st.file_uploader(
            "Upload resume for ATS optimization",
            type=[ext.lstrip(".") for ext in SUPPORTED_EXTENSIONS],
            help="Upload PDF, DOCX, DOC, or TXT resume files.",
            key="optimize_resume_upload",
        )
        industry = st.text_input("Industry or role category", help="Optional context for recommendations.", key="optimize_industry")
        experience_level = st.selectbox(
            "Experience level",
            ["", "Entry-Level (0-2 yrs)", "Mid-Level (2-5 yrs)", "Senior (5-10 yrs)", "Executive (10+ yrs)"],
            key="optimize_experience_level",
        )
    with right_input:
        st.markdown("#### 2. Add the job description")
        job_description = st.text_area("Paste the job description", height=290, key="optimize_job_description")
    analyze_button = st.button("Analyze resume fit", key="analyze_button", type="primary", use_container_width=True)
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
        st.markdown("#### Resume fit overview")
        score_col, match_col, parse_col, relevance_col = st.columns(4)
        score_col.metric("ATS fit", f"{result['ATS_score']}/100")
        match_col.metric("Match", result["match_level"])
        parse_col.metric("Parsability", f"{result['parsability_score']}/45")
        relevance_col.metric("Relevance", f"{result['relevance_score']}/55")
        st.progress(max(0, min(100, int(result["ATS_score"]))) / 100)
        keyword_total = int(result.get("jd_keywords_total") or 0)
        if keyword_total:
            keyword_ratio = int(result.get("matched_keywords_total") or 0) / keyword_total
            st.caption(f"Keyword coverage: {result.get('matched_keywords_total', 0)} of {keyword_total} role keywords found")
            st.progress(min(1.0, keyword_ratio))

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

            email_text = build_job_email_body(target_role, job_results)
            email_subject = build_job_email_subject(target_role)

            smtp_config = get_smtp_config(smtp_host, smtp_port, smtp_username, smtp_password, from_email, use_ssl)
            try:
                with st.spinner("Sending job notification email..."):
                    send_email(email_to, email_subject, email_text, smtp_config)
                st.success(f"Email sent to {email_to}.")
            except Exception as exc:
                st.error(f"Unable to send email: {exc}")
                st.markdown("Please verify SMTP settings or the email credentials.")
        except Exception as exc:
            st.error(f"Job discovery workflow failed: {exc}")


def render_job_notification_workflow(client):
    left, right = st.columns([1, 1.2])
    with left:
        st.markdown("#### Start with your profile")
        uploaded_file = st.file_uploader(
            "Upload resume (optional)",
            type=[ext.lstrip(".") for ext in SUPPORTED_EXTENSIONS],
            help="A resume can help infer target roles. You can also enter a role manually.",
            key="job_search_resume_upload_simple",
        )
    with right:
        st.markdown("#### Set your search")
        role_override = st.text_input(
            "Target role",
            help="For example, Data Analyst or ML Engineer. Leave blank to infer roles from your resume.",
            key="target_role_override",
        )
        email_to = st.text_input("Send job alert to", key="notification_email_simple")
    st.caption("Search starts when you press the button. The app will prepare and send an alert using your configured mail account.")

    run_search = st.button("Find jobs and send alert", key="run_job_search_simple", type="primary", use_container_width=True)
    if not run_search:
        return

    if not uploaded_file and not role_override.strip():
        st.warning("Upload a resume or enter a target role.")
        return
    if not email_to.strip():
        st.warning("Please provide a destination email address.")
        return

    try:
        resume_text = ""
        if uploaded_file:
            with st.spinner("Reading resume..."):
                resume_text = safe_truncate(extract_resume_text(uploaded_file))

        with st.spinner("Finding jobs..."):
            if role_override.strip():
                target_role, job_results, subject, email_text = prepare_job_notification_for_role(role_override)
            else:
                target_role, job_results, subject, email_text = prepare_job_notification(resume_text, client)

        st.session_state["job_results"] = job_results
        job_count = sum(len(group.get("jobs", [])) for group in job_results)
        st.markdown(f"#### {job_count} job leads for {target_role}")
        for group in job_results:
            st.markdown(f"**{group.get('site', 'Job board')}**")
            for job in group.get("jobs", []):
                title = job.get("title", "Untitled role")
                company = job.get("company", "Company not listed")
                location = job.get("location", "Location not listed")
                link = job.get("link", "")
                st.markdown(f"- [{title}]({link}) · {company} · {location}" if link else f"- **{title}** · {company} · {location}")

        smtp_config = active_smtp_config()
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
    st.set_page_config(page_title=PROJECT_NAME, page_icon="R", layout="wide")
    st.markdown("""
    <style>
    :root { color-scheme: light; }
    .stApp { background: #f4f4f3; color: #191a1b; }
    [data-testid="stHeader"] { background: transparent; }
    [data-testid="stToolbar"], footer { visibility: hidden; }
    .block-container { padding: 2.1rem 2.4rem 4rem; max-width: 1320px; }
    [data-testid="stSidebar"] { background: #202123; border-right: 1px solid #303234; }
    [data-testid="stSidebar"] * { color: #f4f4f3; }
    [data-testid="stSidebar"] [data-testid="stMarkdownContainer"] p { color: #aeb0b3; }
    [data-testid="stSidebar"] [role="radiogroup"] { gap: .28rem; }
    [data-testid="stSidebar"] label[data-baseweb="radio"] { padding: .58rem .7rem; border-radius: 9px; transition: background .16s ease; }
    [data-testid="stSidebar"] label[data-baseweb="radio"]:hover { background: #303235; }
    .sidebar-status { display: flex; align-items: center; gap: .55rem; border: 1px solid #424447; border-radius: 9px; padding: .62rem .75rem; color: #e8e9e8; font-size: .84rem; }
    .sidebar-status-dot { width: 7px; height: 7px; border-radius: 50%; background: #c7c9cb; }
    .stTitle, h1, h2, h3 { color: #191a1b; letter-spacing: -.035em; }
    h1 { font-size: clamp(2rem, 3vw, 2.7rem); line-height: 1.08; }
    h2 { font-size: 2rem; }
    p, [data-testid="stCaptionContainer"] { color: #66696d; }
    .welcome-panel { background: linear-gradient(125deg,#222426 0%,#303235 58%,#414346 100%); border-radius: 18px; padding: 2.4rem 2.7rem; margin: .7rem 0 1.2rem; color: #f7f7f6; box-shadow: 0 12px 32px rgba(22,23,24,.10); }
    .welcome-panel h1 { color: #fafaf9; font-size: clamp(2.2rem,4vw,3.45rem); margin: .75rem 0; }
    .welcome-panel h1 span { color: #c2c4c6; }
    .welcome-panel p { max-width: 660px; color: #c7c9cb; font-size: 1.03rem; line-height: 1.65; margin-bottom: .3rem; }
    .eyebrow, .card-kicker { color: #777b80; font-size: .71rem; font-weight: 700; letter-spacing: .14em; }
    .welcome-panel .eyebrow { color: #c1c3c5; }
    .workspace-card { min-height: 205px; padding: 1.5rem; border: 1px solid #dedfdf; border-radius: 15px; background: #fff; transition: transform .18s ease, box-shadow .18s ease; }
    .workspace-card:hover { transform: translateY(-2px); box-shadow: 0 12px 26px rgba(24,25,26,.08); }
    .workspace-card h3 { margin: .85rem 0 .4rem; font-size: 1.35rem; }
    .workspace-card p { line-height: 1.6; font-size: .95rem; }
    .workspace-card .card-foot { margin-top: 1.3rem; color: #74777a; font-size: .68rem; font-weight: 700; letter-spacing: .12em; }
    .workspace-card.card-dark { background: #303235; border-color: #303235; }
    .workspace-card.card-dark h3 { color: #f5f5f4; }
    .workspace-card.card-dark p, .workspace-card.card-dark .card-foot { color: #c2c4c6; }
    .workspace-card.card-dark .card-kicker { color: #c7c9cb; }
    .action-row { display: flex; align-items: center; gap: .8rem; background: #fff; border: 1px solid #e3e3e2; border-radius: 10px; padding: .8rem 1rem; margin: .45rem 0; color: #43464a; }
    .action-dot { width: 7px; height: 7px; border-radius: 50%; background: #4b4e51; flex: 0 0 7px; }
    .page-heading { margin: .4rem 0 1.35rem; }
    .page-heading h2 { margin: .45rem 0 .2rem; }
    .page-heading p { margin: 0; }
    [data-testid="stMetric"] { background: #fff; border: 1px solid #e2e3e2; border-radius: 12px; padding: 1rem 1.1rem; box-shadow: 0 2px 8px rgba(20,21,22,.025); }
    [data-testid="stMetricLabel"] { color: #777a7d; }
    [data-testid="stMetricValue"] { color: #222426; font-weight: 650; }
    [data-testid="stFileUploader"] section, [data-testid="stTextArea"] textarea, [data-testid="stTextInput"] input, [data-baseweb="select"] > div { background: #fff; border-color: #d6d7d7; border-radius: 9px; }
    [data-testid="stTextArea"] textarea:focus, [data-testid="stTextInput"] input:focus { border-color: #626569; box-shadow: 0 0 0 1px #626569; }
    div.stButton > button, div.stDownloadButton > button, [data-testid="stFormSubmitButton"] button { border-radius: 9px; min-height: 2.65rem; font-weight: 600; transition: transform .15s ease, background .15s ease; }
    div.stButton > button:hover, div.stDownloadButton > button:hover { transform: translateY(-1px); }
    div.stButton > button[kind="primary"], [data-testid="stFormSubmitButton"] button[kind="primary"] { background: #242628; border-color: #242628; color: #fff; }
    div[data-testid="stForm"] { background: #fff; border: 1px solid #e2e3e2; border-radius: 14px; padding: 1.25rem; }
    [data-testid="stExpander"] { background: #fff; border: 1px solid #e2e3e2; border-radius: 11px; }
    [data-testid="stAlert"] { background: #ececeb; color: #303235; border: 1px solid #d9dada; }
    [data-testid="stAlert"] svg { fill: #55585b; }
    [data-testid="stProgress"] > div > div { background: #343638; }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition-duration: .01ms !important; animation-duration: .01ms !important; } }
    @media (max-width: 700px) { .block-container { padding: 1rem 1rem 3rem; } .welcome-panel { padding: 1.5rem; } }
    </style>
    """, unsafe_allow_html=True)
    load_dotenv()
    api_key = get_api_key()
    client = get_ai_client() if api_key else None
    pages = ["Overview", "Resume studio", "Job scout", "Mail room", "Email setup", "Application tracker"]
    if "page" not in st.session_state:
        st.session_state["page"] = "Overview"
    with st.sidebar:
        st.markdown(f"# {PROJECT_NAME}")
        st.caption("PERSONAL CAREER AGENT")
        selected = st.radio("Workspace", pages, key="page")
        st.divider()
        if client:
            st.markdown('<div class="sidebar-status"><span class="sidebar-status-dot"></span>AI connected</div>', unsafe_allow_html=True)
        else:
            st.markdown('<div class="sidebar-status"><span class="sidebar-status-dot"></span>AI setup needed</div>', unsafe_allow_html=True)
            st.caption("Add GEMINI_API_KEY to .env to enable analysis.")
        st.caption("Mail uses SMTP settings from .env or your local Outlook profile.")
    if selected == "Overview":
        st.title("Overview")
        st.caption("Your career workspace: resume, opportunities, outreach, and follow-through")
    elif selected == "Job scout":
        st.markdown("""<div class="page-heading"><div class="eyebrow">02 / OPPORTUNITY SCOUT</div>
        <h2>Find roles worth pursuing</h2><p>Search job sources, review the listings, and prepare a useful alert for your inbox.</p></div>""", unsafe_allow_html=True)
    if selected == "Overview":
        render_home()
    elif selected == "Resume studio":
        if not client:
            st.info("Add GEMINI_API_KEY to .env to run resume analysis and optimization.")
        else:
            render_ats_workflow(client)
    elif selected == "Job scout":
        render_job_notification_workflow(client)
    elif selected == "Mail room":
        render_mail_room(client)
    elif selected == "Email setup":
        render_email_setup()
    elif selected == "Application tracker":
        render_application_tracker()


if __name__ == "__main__":
    main()
