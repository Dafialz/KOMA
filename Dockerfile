FROM debian:12-slim

# coturn + iproute2 (щоб зчитати локальний IP) + сертифікати
RUN apt-get update && \
    apt-get install -y --no-install-recommends coturn iproute2 ca-certificates && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Перекривай цим через fly.toml або secrets
ENV REALM="koma.local" \
    TURN_USER="myuser" \
    TURN_PASS="very-strong-pass" \
    PUBLIC_IP4="66.241.124.113" \
    LISTEN_PORT="3478" \
    MIN_PORT="49160" \
    MAX_PORT="49180"

# Беремо першу НЕ secondary адресу з eth0 і запускаємо coturn з правильним external-ip PUBLIC/LOCAL
CMD ["/bin/sh","-c","set -eu; LOCAL_IP=$(ip -4 -o addr show dev eth0 | awk '!/secondary/ {split($4,a,\"/\"); print a[1]; exit}'); echo \"Starting coturn: REALM=$REALM USER=$TURN_USER LISTEN=$LISTEN_PORT PUBLIC=$PUBLIC_IP4 LOCAL=$LOCAL_IP RANGE=$MIN_PORT-$MAX_PORT\"; exec turnserver -n --log-file=stdout --simple-log --fingerprint --lt-cred-mech --realm \"$REALM\" --user \"$TURN_USER:$TURN_PASS\" --listening-port \"$LISTEN_PORT\" --listening-ip 0.0.0.0 --external-ip \"$PUBLIC_IP4/$LOCAL_IP\" --min-port \"$MIN_PORT\" --max-port \"$MAX_PORT\" --no-multicast-peers --no-cli"]
