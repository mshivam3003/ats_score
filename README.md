# ResumeRise AI

AI-powered Resume Optimization & Job Discovery Platform.

Project Role : AI / ML Engineer

Project Role Description : Develops applications and systems that utilize AI tools, Cloud AI services, with proper cloud or on-prem application pipeline with production ready quality. Be able to apply GenAI models as part of the solution. Could also include but not limited to deep learning, neural networks, chatbots, image processing.

Must have skills : Machine Learning (ML)

Good to have skills : NA

Minimum 5 Year(s) Of Experience Is Required

Educational Qualification : 15 years full time education

Summary:

As an AI / ML Engineer, you will engage in the development of applications and systems that leverage artificial intelligence tools and cloud AI services. Your typical day will involve creating production-ready solutions that incorporate generative AI models, deep learning techniques, and neural networks. You will also work on various projects that may include chatbots and image processing, ensuring that all systems are optimized for performance and reliability. Collaboration with cross-functional teams will be essential as you contribute to the design and implementation of innovative AI solutions.

Roles & Responsibilities:

•  Expected to be an SME.
•  Collaborate and manage the team to perform.
•  Responsible for team decisions.
•  Engage with multiple teams and contribute on key decisions.
•  Provide solutions to problems for their immediate team and across multiple teams.
•  Facilitate knowledge sharing sessions to enhance team capabilities.
•  Monitor project progress and ensure alignment with strategic goals.


Professional & Technical Skills:

•  Must To Have Skills: Proficiency in Machine Learning (ML).
•  Strong understanding of deep learning frameworks such as TensorFlow or PyTorch.
•  Experience with cloud platforms like AWS, Azure, or Google Cloud for deploying AI solutions.
•  Familiarity with data preprocessing and feature engineering techniques.
•  Ability to implement and optimize algorithms for performance and scalability.


Additional Information:

 The candidate should have minimum 5 years of experience in Machine Learning (ML).
 This position is based at our Gurugram office.
 A 15 years full time education is required.














-------------------------:prompt:-----------------------------
# for openrouter connection and open source model 

use this (from openai import OpenAI

client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key="<OPENROUTER_API_KEY>",
)

response = client.chat.completions.create(
    model="google/gemini-2.5-flash-lite",
    messages=[
        {"role": "user", "content": "Explain the implications of quantum entanglement."}
    ],
    extra_body={
        "reasoning": {
            "effort": "low"  # Maps to thinkingLevel: "low"
        }
    },
)

msg = response.choices[0].message
print(getattr(msg, "reasoning", None))
print(getattr(msg, "content", None))
) to fix the end point error




this is my final workflow (Resume + JD
   ↓
LLM (understanding)
   ↓
Structured Data (JSON)
   ↓
Rule Engine (math scoring)
   ↓
Final ATS Score)
