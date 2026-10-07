FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    x11vnc novnc python3-websockify \
    && rm -rf /var/lib/apt/lists/*

COPY images/computer/entrypoint.sh /entrypoint.sh
COPY images/computer/vnc-loop.sh /opt/open-bot/vnc-loop.sh
COPY images/computer/vnc-token.sh /opt/open-bot/vnc-token.sh
COPY images/computer/vnc-up.sh /opt/open-bot/vnc-up.sh
COPY images/computer/vnc-down.sh /opt/open-bot/vnc-down.sh
COPY images/computer/novnc/android-keys.js /usr/share/novnc/app/android-keys.js
COPY images/computer/patch-novnc.py /opt/open-bot/patch-novnc.py
RUN python3 /opt/open-bot/patch-novnc.py /usr/share/novnc \
    && chmod 755 /entrypoint.sh /opt/open-bot/vnc-loop.sh /opt/open-bot/vnc-token.sh /opt/open-bot/vnc-up.sh /opt/open-bot/vnc-down.sh /opt/open-bot/patch-novnc.py

EXPOSE 5900 6080
ENTRYPOINT ["/entrypoint.sh"]
