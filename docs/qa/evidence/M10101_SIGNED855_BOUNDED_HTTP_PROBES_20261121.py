import json, subprocess, re, hashlib, datetime, pathlib
BASE='https://127.0.0.1:45279'
CERT='/home/ubuntu/work/hseverify-m10101-staging/tls-cert.pem'
SHA='85554af4aac9dd110627a3176425bf8bf07eff2b'
CASES=[]
def check(name, path, expect, headers=(), method='GET'):
    cmd=['curl','-sS','--cacert',CERT,'--connect-timeout','2','--max-time','8','--max-redirs','0','-D','-','-o','/dev/null','-X',method]
    for key,val in headers: cmd.extend(['-H',f'{key}: {val}'])
    cmd.append(BASE+path)
    p=subprocess.run(cmd,text=True,capture_output=True,timeout=11)
    head=p.stdout
    m=re.search(r'^HTTP/\S+\s+(\d+)',head,re.M)
    status=int(m.group(1)) if m else None
    def hdr(k):
        x=re.search(r'^'+re.escape(k)+r':\s*([^\r\n]*)',head,re.I|re.M)
        return x.group(1) if x else None
    location=hdr('Location')
    suspicious=bool(location and ('attacker.invalid' in location or 'https://attacker.' in location))
    passed=(p.returncode==0 and status in expect and not suspicious)
    CASES.append({'name':name,'status':status,'curl_exit':p.returncode,'location':location,'passed':passed,'has_csp':bool(hdr('Content-Security-Policy')),'csp':hdr('Content-Security-Policy') if name.startswith('nonce-') else None,'cors_origin':hdr('Access-Control-Allow-Origin'),'cors_credentials':hdr('Access-Control-Allow-Credentials')})
for role in ['worker','company','verifier','assessor','admin','root']:
    check('anon-'+role,f'/{role}/dashboard',{307,302,303,401,403})
for role in ['worker','company','verifier','assessor','admin','root']:
    check('middleware-spoof-'+role,f'/{role}/dashboard',{307,302,303,401,403},[('x-middleware-subrequest','middleware:middleware:middleware:middleware:middleware')])
for role in ['worker','company','verifier','assessor','admin','root']:
    check('role-tenant-spoof-'+role,f'/{role}/dashboard',{307,302,303,401,403},[('x-user-role','root'),('x-hse-role','root'),('x-tenant-id','another-tenant')])
check('forwarded-host-root','/root/dashboard',{307,302,303,401,403},[('x-forwarded-host','attacker.invalid'),('x-forwarded-proto','http')])
check('host-only-root','/root/dashboard',{307,302,303,401,403},[('Host','attacker.invalid')])
check('protected-readiness','/api/operations/readiness',{401,403},[('x-middleware-subrequest','middleware:middleware')])
check('private-export','/api/company/workers/export',{307,302,303,401,403},[('x-middleware-subrequest','middleware:middleware')])
check('file-forged','/api/secure-files/download?fileId=synthetic-missing',{400,401,403,404},[('x-user-role','root')])
check('nonce-a','/worker/login',{200})
check('nonce-b','/worker/login',{200})
check('cors-preflight','/api/operations/readiness',{200,204,400,401,403,404,405},[('Origin','https://attacker.invalid'),('Access-Control-Request-Method','GET')],method='OPTIONS')
na,nb=(next(x for x in CASES if x['name']==name) for name in ['nonce-a','nonce-b'])
def nonce(x):
    m=re.search(r"'nonce-([^']+)'",x['csp'] or '')
    return m.group(1) if m else None
nonce_ok=bool(nonce(na) and nonce(nb) and nonce(na)!=nonce(nb) and "'unsafe-inline'" not in (na['csp'] or '').split('script-src ')[-1].split(';')[0])
cors=CASES[-1]
cors_ok=not (cors['cors_origin']=='*' and str(cors['cors_credentials']).lower()=='true') and cors['cors_origin']!='https://attacker.invalid'
all_ok=all(x['passed'] for x in CASES) and nonce_ok and cors_ok
out={'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source_sha':SHA,'target':'isolated loopback TLS stage PostgreSQL16','count':len(CASES),'passed_http_cases':sum(x['passed'] for x in CASES),'nonce_unique':nonce_ok,'hostile_cors_denied':cors_ok,'all_pass':all_ok,'cases':CASES}
p=pathlib.Path('.autopilot/artifacts/m10101-signed855-bounded-http-probes.json')
p.write_text(json.dumps(out,indent=2)+'\n')
print('SHA',SHA,'HTTP',sum(x['passed'] for x in CASES),'/',len(CASES),'CSP_NONCE_UNIQUE',nonce_ok,'HOSTILE_CORS_DENIED',cors_ok,'OVERALL', 'PASS' if all_ok else 'FAIL')
for x in CASES: print(x['name'],x['status'],'PASS' if x['passed'] else 'FAIL',str(x['location'])[:120] if x['location'] else '')
print('ARTIFACT',str(p),'SHA256',hashlib.sha256(p.read_bytes()).hexdigest())
raise SystemExit(0 if all_ok else 1)
