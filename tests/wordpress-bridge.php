<?php
// Isolated WordPress API stubs; no WordPress site, clients or network requests.
define('ABSPATH', '/synthetic-wordpress/');
function add_action(...$args){} function add_filter(...$args){}
$options=array();
function get_option($key,$fallback=false){global $options;return $options[$key]??$fallback;}
function update_option($key,$value,...$args){global $options;$options[$key]=$value;return true;}
function wp_strip_all_tags($v){return strip_tags($v);}
function wp_parse_url($url,$part){return parse_url($url,$part);}
function wp_json_encode($v){return json_encode($v,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);}
function wp_generate_uuid4(){static $n=100;return sprintf('10000000-0000-4000-8000-%012d',$n++);}
function check($v,$message){if(!$v)throw new RuntimeException($message);}
function rejects($fn){try{$fn();}catch(RuntimeException $e){return;}throw new RuntimeException('Expected rejection');}
class FakeDb {
 public $prefix='synthetic_';public $rows=array();public $lock=true;
 function prepare($sql,...$args){return array($sql,$args);}
 function get_row($q){$r=$this->rows[$q[1][0]]??null;return $r?(object)$r:null;}
 function insert($table,$row){$row['attempts']=0;$this->rows[$row['event_id']]=$row;return 1;}
 function get_results($q){return array_map(fn($r)=>(object)$r,array_values(array_filter($this->rows,fn($r)=>$r['status']==='pending')));}
 function query($q){if(!$this->lock)return 0;return 1;}
 function update($table,$changes,$where){$id=$where['event_id'];$this->rows[$id]=array_merge($this->rows[$id],$changes);return 1;}
}
$wpdb=new FakeDb();$http=200;$calls=0;$last_request=null;
function wp_remote_post($url,$options){global $http,$calls,$last_request;$calls++;$last_request=$options;check($url==='https://crm.garantiaporto.com.uy/api/integration/events','fixed destination');return array('code'=>$http);}
function is_wp_error($v){return false;}
function wp_remote_retrieve_response_code($r){return $r['code'];}
function wp_remote_retrieve_body($r){return json_encode(array('application_id'=>'20000000-0000-4000-8000-000000000001'));}
function wp_remote_retrieve_header(...$args){return '120';}
require __DIR__.'/../integrations/wordpress/bridge.php';
$class='Porto_CRM_Elementor_Bridge_V1';
$f=array('solicitud_id'=>'10000000-0000-4000-8000-000000000001','event_id'=>'10000000-0000-4000-8000-000000000002',
 'nombre'=>'Persona Ficticia','celular'=>'099123456','alquiler'=>'$25.000','moneda'=>'UYU',
 'boton_origen'=>'Cotizador ficticio','url_origen'=>'https://example.test/?utm_source=ficticio&gclid=click-ficticio&gad_campaignid=123','pagina_origen'=>'Página ficticia');
$e=$class::event($f,1,'Lead Garantía - Paso 1');
check($e['data']['phone']==='59899123456','phone normalization');
check($e['data']['rent_amount']===25000.0,'rent normalization');
check($e['data']['utm_source']==='ficticio','marketing');
check($e['extra']->elementor_pagina_origen==='Página ficticia','original fields');
check(!isset($e['data']['consent_evidence']),'no invented consent');
check($class::money('U$S 1.200,50')===1200.5,'USD parsing');
rejects(fn()=>$class::money('12.34'));rejects(fn()=>$class::money('-100'));
rejects(fn()=>$class::event(array_merge($f,array('event_id'=>'')),1,'form'));
$f2=array('solicitud_id'=>$f['solicitud_id'],'event_id'=>'10000000-0000-4000-8000-000000000003','nombre_paso1'=>$f['nombre'],
 'celular_paso1'=>$f['celular'],'alquiler_paso1'=>$f['alquiler'],'moneda_paso1'=>'UYU','cedula'=>'0.000.000-0','ingresos'=>'$60.000');
$e2=$class::event($f2,2,'Solicitud Garantía - Datos adicionales');
check($e2['solicitud_id']===$e['solicitud_id'],'same request');check($e2['data']['monthly_income']===60000.0,'income');
class Record {
 public $fields;public $name;
 function __construct($fields,$name='Lead Garantía - Paso 1'){$this->fields=$fields;$this->name=$name;}
 function get_form_settings($k){return $this->name;}
 function get($k){return array_map(fn($v)=>array('value'=>$v),$this->fields);}
}
$options['porto_crm_bridge_schema']='1';
$class::capture(new Record($f),null);check(count($wpdb->rows)===0,'disabled by default');
$options[$class::OPTION]=array('capture'=>true,'send'=>false,'secret'=>str_repeat('a',64));
$class::capture(new Record($f,'Otro formulario'),null);check(count($wpdb->rows)===0,'unrelated form ignored');
$class::capture(new Record($f),null);check(count($wpdb->rows)===1,'durable capture');check($calls===0,'no HTTP in submission');
$class::capture(new Record($f),null);check(count($wpdb->rows)===1,'duplicate submission skipped');
$class::work();check($calls===0,'send disabled');
$options[$class::OPTION]['send']=true;
$wpdb->lock=false;$class::work();check($calls===0,'lease prevents concurrent send');$wpdb->lock=true;
$http=503;$class::work();check($wpdb->rows[$f['event_id']]['status']==='pending','503 retained for retry');
$first_body=$last_request['body'];
$stamp=$last_request['headers']['x-crm-timestamp'];
check(hash_equals(hash_hmac('sha256',$stamp.'.'.$first_body,str_repeat('a',64)),$last_request['headers']['x-crm-signature']),'HMAC exact body');
$http=200;$class::work();check($last_request['body']===$first_body,'retry body stable');check($wpdb->rows[$f['event_id']]['status']==='sent','confirmed delivery');
$class::capture(new Record($f2,'Solicitud Garantía - Datos adicionales'),null);
$http=401;$class::work();check($wpdb->rows[$f2['event_id']]['status']==='error','401 requires manual correction');
$class::capture(new Record(array_merge($f,array('alquiler'=>'$30.000'))),null);
check(count(array_filter($wpdb->rows,fn($r)=>$r['status']==='review'))===1,'conflict retained for review');
$class::capture(new Record(array_merge($f,array('event_id'=>''))),null);
check(count(array_filter($wpdb->rows,fn($r)=>$r['status']==='review'))===2,'invalid identifiers retained');
file_put_contents('/tmp/porto-wordpress-fixtures.json',json_encode(array($e,$e2)));
echo "PASS: mapping, money, identity, marketing, default off, queue, duplicates, conflict review, lease, signing, retries.\n";
