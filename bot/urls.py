from django.urls import path
from . import views
urlpatterns = [path("", views.home), path("api/start/", views.start), path("api/message/<int:pk>/", views.message), path("api/finish/<int:pk>/", views.finish), path("api/recording/<int:pk>/", views.recording)]
