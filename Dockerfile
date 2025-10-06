FROM debian:12-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends coturn ca-certificates && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Значення можна перекрити секретами/ENV у fly.toml
ENV REALM="koma.local" \
    TURN_USER="myuser" \
    TURN_PASS="very-strong-pass" \
    PUBLIC_IP4="66.241.124.113" \
    LISTEN_PORT="3478" \
    MIN_PORT="49160" \
    MAX_PORT="49180"

# ВАЖЛИВО:
# На Fly у VM немає публічної 66.x на інтерфейсі → використовуємо --external-ip,
# а НЕ --relay-ip. Це і прибирає помилку 701.
CMD ["/bin/sh","-c","turnserver -n --log-file=stdout --simple-log --fingerprint --lt-cred-mech \
  --realm \"$REALM\" --user \"$TURN_USER:$TURN_PASS\" \
  --listening-port \"$LISTEN_PORT\" --listening-ip 0.0.0.0 \
  --external-ip \"$PUBLIC_IP4\" \
  --min-port \"$MIN_PORT\" --max-port \"$MAX_PORT\" \
  --no-multicast-peers --no-cli"]
