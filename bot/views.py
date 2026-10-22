import json, os, requests
from django.conf import settings
from django.shortcuts import render, get_object_or_404
from django.http import JsonResponse
from django.views.decorators.http import require_POST
from django.views.decorators.csrf import csrf_exempt
from django.core.files.base import ContentFile
from .models import Call

def product_info(product_name):
    return (
        f"You are a professional, friendly AI sales representative selling {product_name}, a SaaS product. "
        "Treat the product name as user-provided; do not claim specific features, integrations, prices, or discounts "
        "unless the customer or product brief provides them. If details are unknown, say so honestly and ask a useful "
        "discovery question. Start by understanding the customer's role, team size, current workflow, and biggest pain "
        "point. Keep spoken answers natural and concise (usually 1-3 sentences). Listen to objections without arguing; "
        "respond empathetically, connect benefits to the customer's stated need, and ask one relevant question at a time. "
        "When appropriate, offer a demo or a follow-up. Never pressure the customer, invent facts, or claim a purchase "
        "was completed unless the customer explicitly confirms it."
    )

def ask_gemini(prompt, json_mode=False):
    key = os.getenv("GEMINI_API_KEY", "").strip()
    if not key:
        return None
    model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash-lite")
    url = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + key
    body = {"contents":[{"parts":[{"text":prompt}]}]}
    if json_mode:
        body["generationConfig"] = {"responseMimeType":"application/json"}
    try:
        response = requests.post(url, json=body, timeout=20)
        response.raise_for_status()
        return response.json()["candidates"][0]["content"]["parts"][0]["text"]
    except Exception:
        return None

def home(request):
    return render(request, "home.html", {"calls":Call.objects.order_by("-created_at")[:25], "total":Call.objects.count()})

@csrf_exempt
@require_POST
def start(request):
    data = json.loads(request.body or "{}")
    call = Call.objects.create(product_name=(data.get("product") or "CloudTask Pro")[:120], recording_consent=bool(data.get("consent")))
    greeting = "Hello! I'm the AI sales assistant for " + call.product_name + ". I'll answer your questions and help you see whether it fits your needs. What would you like your team to improve?"
    call.transcript = [{"role":"assistant","text":greeting}]
    call.save()
    return JsonResponse({"id":call.id,"greeting":greeting})

@csrf_exempt
@require_POST
def message(request, pk):
    call = get_object_or_404(Call, pk=pk)
    data = json.loads(request.body or "{}")
    user_text = str(data.get("text","")).strip()[:2500]
    if not user_text:
        return JsonResponse({"error":"Empty message"}, status=400)
    call.transcript.append({"role":"user","text":user_text})
    history = "\n".join(x["role"] + ": " + x["text"] for x in call.transcript[-14:])
    answer = ask_gemini(
        product_info(call.product_name)
        + "\nConversation so far:\n" + history
        + "\nRespond to the customer's latest message as a consultative SaaS salesperson. "
          "Use the conversation context, answer directly, and ask at most one natural follow-up question. "
          "Return only the spoken reply, without labels or bullet points."
    )
    if not answer:
        low = user_text.lower()
        if any(k in low for k in ["price","cost","how much"]):
            answer = "Our example plans are Starter at $9 per user per month and Team at $15 per user per month. How many people are on your team?"
        elif "demo" in low:
            answer = "I'd be happy to arrange a product demo. What day and time would suit you?"
        elif any(k in low for k in ["expensive","budget"]):
            answer = "I understand budget is important. Let's focus on the features your team needs most. How many people would use the product?"
        elif any(k in low for k in ["not interested","stop","no thanks"]):
            answer = "Thanks for letting me know. I won't push further. Would you like me to close the conversation?"
        elif any(k in low for k in ["need", "looking for", "manage", "problem", "challenge", "team"]):
            answer = "I can help you explore whether this product is a fit. What is the biggest problem you want it to solve, and how does your team handle that today?"
        elif any(k in low for k in ["hello", "hi", "hey"]):
            answer = "Hi, thanks for speaking with me. Before I recommend anything, could you tell me a little about your team and what you would like to improve?"
        else:
            answer = "Thanks for sharing that. To make this useful, could you tell me what matters most to you: saving time, reducing costs, improving team collaboration, or something else?"
    call.transcript.append({"role":"assistant","text":answer})
    call.save()
    return JsonResponse({"reply":answer})

@csrf_exempt
@require_POST
def finish(request, pk):
    call = get_object_or_404(Call, pk=pk)
    data = json.loads(request.body or "{}")
    call.duration_seconds = min(int(data.get("duration",0)), 86400)
    transcript = "\n".join(x["role"] + ": " + x["text"] for x in call.transcript)
    prompt = "Analyze this sales conversation. Return JSON keys summary, requirements, objections, next_steps, sales_status. sales_status must be exactly one of Converted, Interested, Follow-up Required, Not Interested, Demo Requested, No Response. Use evidence only. Explicit demo request => Demo Requested; explicit decline => Not Interested; no customer message => No Response.\n" + transcript
    result = ask_gemini(prompt, True)
    parsed = None
    if result:
        try: parsed = json.loads(result)
        except Exception: parsed = None
    if not parsed:
        text = " ".join(x["text"].lower() for x in call.transcript if x["role"]=="user")
        status = "No Response" if not text else "Demo Requested" if "demo" in text else "Not Interested" if any(k in text for k in ["not interested","no thanks","stop calling"]) else "Follow-up Required" if any(k in text for k in ["later","follow up","think about"]) else "Interested"
        parsed = {"summary":"Review the transcript for the main discussion and buying intent.","requirements":"Review the transcript for customer needs.","objections":"Review the transcript for objections.","next_steps":"Follow up based on the customer's stated interest.","sales_status":status}
    valid = [s[0] for s in Call.STATUSES]
    call.summary = str(parsed.get("summary",""))[:2500]
    call.requirements = str(parsed.get("requirements",""))[:1500]
    call.objections = str(parsed.get("objections",""))[:1500]
    call.next_steps = str(parsed.get("next_steps",""))[:1500]
    call.sales_status = parsed.get("sales_status") if parsed.get("sales_status") in valid else "Interested"
    call.save()
    return JsonResponse({"summary":call.summary,"requirements":call.requirements,"objections":call.objections,"next_steps":call.next_steps,"status":call.sales_status})

@csrf_exempt
@require_POST
def recording(request, pk):
    call = get_object_or_404(Call, pk=pk)
    if not call.recording_consent:
        return JsonResponse({"error":"Recording consent was not granted"}, status=403)
    file = request.FILES.get("audio")
    if not file:
        return JsonResponse({"error":"No audio file"}, status=400)
    call.recording.save("call_" + str(call.pk) + ".webm", ContentFile(file.read()), save=True)
    return JsonResponse({"url":call.recording.url})
