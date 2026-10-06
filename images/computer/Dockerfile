FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    x11vnc novnc python3-websockify \
    && rm -rf /var/lib/apt/lists/*

COPY images/computer/entrypoint.sh /entrypoint.sh
RUN chmod 755 /entrypoint.sh

EXPOSE 5900 6080
ENTRYPOINT ["/entrypoint.sh"]
