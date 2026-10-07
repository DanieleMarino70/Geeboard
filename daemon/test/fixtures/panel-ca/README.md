# Test authority for `panel-ca.test.ts`

A throw-away certificate authority and what it signed, so the test can run a real TLS server and a real node fetching from it.
**They protect nothing.** `leaf.key` is committed on purpose; the authority's own key was deleted after it signed the leaf.

| File | What it is |
|---|---|
| `root.crt` | the authority ("Geeboard test authority"), valid 100 years |
| `leaf.crt`, `leaf.key` | a certificate for `127.0.0.1` / `localhost`, signed by `root.crt` |
| `other.crt` | a second authority with another key, for "the panel offered a different one" |

Made once, with OpenSSL 3 and P-256 keys. Nothing in the product reads these files.

```sh
openssl ecparam -name prime256v1 -genkey -noout -out root.key
openssl req -x509 -new -key root.key -sha256 -days 36500 -subj "/CN=Geeboard test authority (protects nothing)" \
  -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" -out root.crt
openssl ecparam -name prime256v1 -genkey -noout -out leaf.key
openssl req -new -key leaf.key -subj "/CN=127.0.0.1" -out leaf.csr
printf 'basicConstraints=CA:FALSE\nkeyUsage=digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:127.0.0.1,DNS:localhost\n' > leaf.cnf
openssl x509 -req -in leaf.csr -CA root.crt -CAkey root.key -CAcreateserial -sha256 -days 36500 -extfile leaf.cnf -out leaf.crt
# other.crt: the same as root.crt, from another key, and nothing signed by it
```
