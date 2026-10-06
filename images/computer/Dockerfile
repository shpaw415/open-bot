FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    x11vnc novnc python3-websockify \
    && rm -rf /var/lib/apt/lists/*

COPY images/computer/entrypoint.sh /entrypoint.sh
COPY images/computer/vnc-loop.sh /opt/open-bot/vnc-loop.sh
COPY images/computer/vnc-token.sh /opt/open-bot/vnc-token.sh
COPY images/computer/vnc-up.sh /opt/open-bot/vnc-up.sh
COPY images/computer/vnc-down.sh /opt/open-bot/vnc-down.sh
RUN chmod 755 /entrypoint.sh /opt/open-bot/vnc-loop.sh /opt/open-bot/vnc-token.sh /opt/open-bot/vnc-up.sh /opt/open-bot/vnc-down.sh

EXPOSE 5900 6080
ENTRYPOINT ["/entrypoint.sh"]
