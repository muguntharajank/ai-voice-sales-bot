from django.db import models
class Call(models.Model):
    STATUSES = [(s,s) for s in ["Converted","Interested","Follow-up Required","Not Interested","Demo Requested","No Response"]]
    created_at = models.DateTimeField(auto_now_add=True)
    duration_seconds = models.PositiveIntegerField(default=0)
    product_name = models.CharField(max_length=120, default="CloudTask Pro")
    transcript = models.JSONField(default=list, blank=True)
    summary = models.TextField(blank=True)
    requirements = models.TextField(blank=True)
    objections = models.TextField(blank=True)
    next_steps = models.TextField(blank=True)
    sales_status = models.CharField(max_length=30, choices=STATUSES, default="No Response")
    recording = models.FileField(upload_to="recordings/", blank=True)
    recording_consent = models.BooleanField(default=False)
