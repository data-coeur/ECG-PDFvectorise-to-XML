# Build recipe for the LIRYC ecg_converter submodule (github.com/LIRYC-IHU/ecg_converter).
#
# Upstream's own Dockerfile is `FROM mono:latest`, which is still pinned to
# Debian Buster — now EOL, so `apt update` returns 404 and the build fails.
# We keep the app code and ECG Toolkit DLLs UNCHANGED from the submodule and
# only swap the build environment: a maintained Debian Bookworm base with mono
# installed from Debian's own repos. Build context is the repo root so we can
# COPY out of the `ecg_converter/` submodule checkout.
#
# Python 3.10 (not 3.11): upstream pins FastAPI 0.78 / pydantic 1.9.1, whose
# generated model signatures break on 3.11's stricter inspect module
# (`ValueError: 'not' is not a valid parameter name`). 3.10 runs them fine.
FROM python:3.10-slim-bookworm

# mono-complete: full Mono runtime to execute the .NET ECG Toolkit assemblies.
# libgdiplus: System.Drawing backend (needed by the PDF/image plugins).
RUN apt-get update && apt-get install -y --no-install-recommends \
      mono-complete libgdiplus \
    && rm -rf /var/lib/apt/lists/*

COPY ecg_converter/ECGToolkit /opt/ecg_toolkit
COPY ecg_converter/convert.sh /bin/convert
COPY ecg_converter/requirements.txt /opt/requirements.txt
RUN chmod +x /bin/convert && pip3 install --no-cache-dir -r /opt/requirements.txt
COPY ecg_converter/app /app

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "80"]
