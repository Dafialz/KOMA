FROM debian:12-slim

# coturn + iproute2 (щоб визначити локальну IP) + сертифікати
RUN apt-get update && \
    apt-get install -y --no-install-recommends coturn iproute2 ca-certificates && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Значення можна перекривати секретами/ENV у fly.toml
ENV REALM="koma.local" \
    TURN_USER="myuser" \
    TURN_PASS="very-strong-pass" \
    PUBLIC_IP4="66.241.124.113" \
    LISTEN_PORT="3478" \
    MIN_PORT="49160" \
    MAX_PORT="49180"

# Стартовий скрипт: надійно бере одну локальну IPv4 і запускає turnserver
RUN set -eux; \
  cat > /usr/local/bin/start-turn.sh << 'EOSH'
#!/bin/sh
set -eu

# Надійно отримати локальну IPv4, яку реально використовує маршрут у зовнішній світ
LOCAL_IP="$(ip -4 route get 1.1.1.1 | awk 'NR==1{print $7}')"
# Фолбек: перша адреса інтерфейсу eth0
if [ -z "${LOCAL_IP:-}" ]; then
  LOCAL_IP="$(ip -4 -o addr show dev eth0 | awk 'NR==1{split($4,a,"/");print a[1]}')"
fi

echo "Starting coturn:"
echo "  REALM=$REALM"
echo "  USER=$TURN_USER"
echo "  LISTEN=$LISTEN_PORT (tcp/udp)"
echo "  EXTERNAL=$PUBLIC_IP4 / LOCAL=$LOCAL_IP"
echo "  MEDIA RANGE=$MIN_PORT-$MAX_PORT/udp"

exec turnserver -n \
  --log-file=stdout --simple-log --fingerprint --lt-cred-mech \
  --realm "$REALM" --user "$TURN_USER:$TURN_PASS" \
  --listening-ip 0.0.0.0 --listening-port "$LISTEN_PORT" \
  --external-ip "$PUBLIC_IP4/$LOCAL_IP" \
  --min-port "$MIN_PORT" --max-port "$MAX_PORT" \
  --no-multicast-peers --no-cli
EOSH
RUN chmod +x /usr/local/bin/start-turn.sh

# Документація портів у контейнері
EXPOSE 3478/udp 3478/tcp
EXPOSE 49160-49180/udp

CMD ["/usr/local/bin/start-turn.sh"]
