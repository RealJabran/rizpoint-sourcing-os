# Sanitized security-event forwarding. Application security events already
# redact credentials and provider payloads before reaching journald.
module(load="imjournal" StateFile="rizpoint-imjournal.state")
module(load="imfile")
module(load="omfwd")

input(type="imfile" File="/var/log/suricata/eve.json" Tag="rizpoint-ids" Severity="warning" Facility="local6")
input(type="imfile" File="/var/log/clamav/clamav.log" Tag="rizpoint-antimalware" Severity="warning" Facility="local6")
input(type="imfile" File="/var/log/ufw.log" Tag="rizpoint-firewall" Severity="notice" Facility="local6")

template(name="RizPointSecurity" type="list") {
  property(name="timereported" dateFormat="rfc3339")
  constant(value=" ") property(name="hostname")
  constant(value=" ") property(name="syslogtag")
  constant(value=" ") property(name="msg" controlCharacters="escape")
  constant(value="\n")
}

if ($syslogtag startswith "rizpoint" or $syslogtag startswith "suricata" or
    $syslogtag startswith "clam" or $syslogtag startswith "UFW") then {
  action(type="omfwd" Target="@@SIEM_HOST@@" Port="@@SIEM_PORT@@" Protocol="tcp"
    StreamDriver="gtls" StreamDriverMode="1" StreamDriverAuthMode="x509/name"
    StreamDriverPermittedPeers="@@SIEM_PEER@@"
    StreamDriverCAFile="/etc/rizpoint-security/siem-ca.pem"
    Template="RizPointSecurity" action.resumeRetryCount="-1"
    queue.type="LinkedList" queue.filename="rizpoint-siem" queue.saveOnShutdown="on")
  stop
}
