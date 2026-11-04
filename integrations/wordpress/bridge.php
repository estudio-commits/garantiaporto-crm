<?php
/** Porto CRM / Elementor bridge. Build WPCode snippet with build-snippet.py. */
if (!defined('ABSPATH') || class_exists('Porto_CRM_Elementor_Bridge_V1')) { return; }
final class Porto_CRM_Elementor_Bridge_V1 {
    const OPTION = 'porto_crm_bridge_v1';
    const CRON = 'porto_crm_bridge_tick_v1';
    const ENDPOINT = 'https://crm.garantiaporto.com.uy/api/integration/events';
    static function table() { global $wpdb; return $wpdb->prefix . 'porto_crm_queue'; }
    static function config() { return (array) get_option(self::OPTION, array()); }
    static function boot() {
        add_action('admin_init', array(__CLASS__, 'install'));
        add_action('admin_menu', array(__CLASS__, 'menu'));
        add_action('admin_post_porto_crm_save', array(__CLASS__, 'save'));
        add_action('admin_post_porto_crm_retry', array(__CLASS__, 'retry'));
        add_filter('cron_schedules', array(__CLASS__, 'schedules'));
        add_action('init', array(__CLASS__, 'schedule'));
        add_action(self::CRON, array(__CLASS__, 'work'));
        add_action('elementor_pro/forms/new_record', array(__CLASS__, 'capture'), 20, 2);
        add_action('wp_enqueue_scripts', function () {
            if (!empty(self::config()['capture'])) wp_enqueue_script('jquery');
        });
        add_action('wp_footer', array(__CLASS__, 'browser'), 50);
    }
    static function install() {
        if (!current_user_can('manage_options') || get_option('porto_crm_bridge_schema') === '1') return;
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $table = self::table(); $charset = $wpdb->get_charset_collate();
        dbDelta("CREATE TABLE $table (
          event_id varchar(36) NOT NULL,
          request_id varchar(36) NOT NULL,
          step tinyint NOT NULL,
          payload longtext NOT NULL,
          fingerprint varchar(64) NOT NULL,
          status varchar(20) NOT NULL DEFAULT 'pending',
          attempts int NOT NULL DEFAULT 0,
          next_attempt datetime NOT NULL,
          created_at datetime NOT NULL,
          updated_at datetime NOT NULL,
          last_code varchar(80) NOT NULL DEFAULT '',
          PRIMARY KEY  (event_id),
          KEY pending (status,next_attempt),
          KEY request_step (request_id,step)
        ) $charset;");
        if ($wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $wpdb->esc_like($table))) === $table)
            update_option('porto_crm_bridge_schema', '1', false);
    }
    static function schedules($s) { $s['porto_minute'] = array('interval'=>60,'display'=>'Porto CRM: cada minuto'); return $s; }
    static function schedule() {
        if (get_option('porto_crm_bridge_schema') === '1' && !wp_next_scheduled(self::CRON))
            wp_schedule_event(time()+60, 'porto_minute', self::CRON);
    }
    static function text($v, $limit=2000) {
        if (is_array($v)) $v = implode(', ', array_map('strval', $v));
        $v = trim(wp_strip_all_tags((string)$v));
        if (strlen($v)>$limit) throw new RuntimeException('field_too_long');
        return $v;
    }
    static function uuid($v) { return is_string($v) && preg_match('/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i', $v); }
    static function money($v) {
        $v = preg_replace('/^(?:U\$S|UYU|USD|\$)\s*/i', '', trim($v));
        if ($v==='') return null;
        if (!preg_match('/^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?$/', $v)) throw new RuntimeException('invalid_amount');
        $n=(float)str_replace(',', '.', str_replace('.', '', $v));
        if ($n>1e12) throw new RuntimeException('amount_too_large');
        return $n;
    }
    static function phone($v) {
        $v=preg_replace('/\D/', '', $v);
        if (preg_match('/^09\d{7}$/', $v)) $v='598'.substr($v,1);
        elseif (preg_match('/^9\d{7}$/', $v)) $v='598'.$v;
        elseif (strpos($v,'00598')===0) $v=substr($v,2);
        if (strlen($v)<3 || strlen($v)>40) throw new RuntimeException('invalid_phone');
        return $v;
    }
    static function event($fields, $step, $form) {
        $f=array(); foreach ($fields as $k=>$v) $f[$k]=self::text($v);
        if (!self::uuid($f['solicitud_id']??'') || !self::uuid($f['event_id']??'')) throw new RuntimeException('missing_identifiers');
        $suffix=$step===1?'':'_paso1';
        $name=self::text($f['nombre'.$suffix]??'',200);
        if ($name==='') throw new RuntimeException('missing_name');
        $currency=$f['moneda'.$suffix]??'';
        if (!in_array($currency,array('UYU','USD'),true)) throw new RuntimeException('invalid_currency');
        $data=array('full_name'=>$name,'phone'=>self::phone($f['celular'.$suffix]??''),
          'rent_amount'=>self::money($f['alquiler'.$suffix]??''),'rent_currency'=>$currency,'form_id'=>$form);
        if ($step===2) {
            $data['national_id']=self::text($f['cedula']??'',40);
            $data['monthly_income']=self::money($f['ingresos']??'');
        }
        if (!empty($f['boton_origen'])) $data['button_origin']=self::text($f['boton_origen'],300);
        if (!empty($f['url_origen'])) $data['source_url']=$f['url_origen'];
        // Preserve actual evidence only. Explanatory HTML is not proof of a checked opt-in.
        if (!empty($f['consentimiento'])) $data['consent_evidence']=self::text($f['consentimiento'],1000);
        $query=array(); parse_str((string)wp_parse_url($f['url_origen']??'',PHP_URL_QUERY),$query);
        foreach (array('utm_source','utm_medium','utm_campaign','utm_content','utm_term','gclid','gbraid','wbraid','fbclid') as $key) {
            $v=$f[$key]??($query[$key]??'');
            if ($v!=='' && !is_array($v)) $data[$key]=self::text($v,strpos($key,'utm_')===0?300:500);
        }
        $extra=array();
        foreach ($f as $key=>$v) {
            if (in_array($key,array('solicitud_id','event_id'),true)) continue;
            if (strlen('elementor_'.$key)>100) throw new RuntimeException('field_key_too_long');
            $extra['elementor_'.$key]=$v;
        }
        foreach(array('gad_source','gad_campaignid') as $key) if(isset($query[$key]) && !is_array($query[$key])) $extra[$key]=self::text($query[$key]);
        $e=array('schema_version'=>1,'event_id'=>$f['event_id'],'solicitud_id'=>$f['solicitud_id'],
          'step'=>$step,'sent_at'=>gmdate('Y-m-d\TH:i:s\Z'),'data'=>$data,'extra'=>(object)$extra);
        if (strlen(wp_json_encode($e))>32768) throw new RuntimeException('payload_too_large');
        return $e;
    }
    static function capture($record, $handler) {
        if (empty(self::config()['capture'])) return;
        $name=$record->get_form_settings('form_name');
        $forms=array('Lead Garantía - Paso 1'=>1,'Solicitud Garantía - Datos adicionales'=>2);
        if (!isset($forms[$name])) return;
        global $wpdb; $fields=array();
        foreach ((array)$record->get('fields') as $id=>$field) $fields[$id]=$field['value']??'';
        $status='pending'; $code='';
        try {
            if (get_option('porto_crm_bridge_schema')!=='1') throw new RuntimeException('queue_not_installed');
            $e=self::event($fields,$forms[$name],$name);
        } catch (Throwable $error) {
            // Elementor's own submissions/emails remain intact; retain an admin-review record too.
            $status='review'; $code=$error->getMessage();
            $e=array('event_id'=>wp_generate_uuid4(),'solicitud_id'=>wp_generate_uuid4(),'step'=>$forms[$name],
                'sent_at'=>gmdate('Y-m-d\TH:i:s\Z'),'original_fields'=>$fields,'form_name'=>$name);
        }
        $payload=wp_json_encode($e); $hash=hash('sha256',wp_json_encode(array_diff_key($e,array('sent_at'=>true))));
        $table=self::table();
        $existing=$wpdb->get_row($wpdb->prepare("SELECT fingerprint FROM $table WHERE event_id=%s",$e['event_id']));
        if ($existing) {
            if (hash_equals($existing->fingerprint,$hash)) return;
            update_option('porto_crm_bridge_notice','event_id_conflict: revisar envíos en Elementor',false);
            // Preserve the conflicting submission for review; never overwrite or send it as a new client.
            $status='review'; $code='event_id_conflict';
            $e['original_event_id']=$e['event_id']; $e['event_id']=wp_generate_uuid4();
            $payload=wp_json_encode($e);
        }
        $ok=$wpdb->insert($table,array('event_id'=>$e['event_id'],'request_id'=>$e['solicitud_id'],'step'=>$e['step'],
          'payload'=>$payload,'fingerprint'=>$hash,'status'=>$status,'last_code'=>$code,
          'next_attempt'=>gmdate('Y-m-d H:i:s'),'created_at'=>gmdate('Y-m-d H:i:s'),'updated_at'=>gmdate('Y-m-d H:i:s')));
        if (!$ok) update_option('porto_crm_bridge_notice','queue_write_failed: revisar envíos en Elementor',false);
        // No HTTP request here: displaying step 2 must not wait for Vercel.
    }
    static function work() {
        $config=self::config();
        if (empty($config['send']) || empty($config['secret']) || get_option('porto_crm_bridge_schema')!=='1') return;
        global $wpdb; $table=self::table();
        $rows=$wpdb->get_results("SELECT * FROM $table WHERE (status='pending' AND next_attempt<=UTC_TIMESTAMP()) OR (status='sending' AND updated_at<DATE_SUB(UTC_TIMESTAMP(),INTERVAL 5 MINUTE)) ORDER BY created_at LIMIT 5");
        foreach ($rows as $row) {
            $claimed=$wpdb->query($wpdb->prepare("UPDATE $table SET status='sending',updated_at=UTC_TIMESTAMP(),attempts=attempts+1 WHERE event_id=%s AND ((status='pending' AND next_attempt<=UTC_TIMESTAMP()) OR (status='sending' AND updated_at<DATE_SUB(UTC_TIMESTAMP(),INTERVAL 5 MINUTE)))",$row->event_id));
            if ($claimed!==1) continue;
            $stamp=(string)time();
            $response=wp_remote_post(self::ENDPOINT,array('timeout'=>10,'redirection'=>0,'sslverify'=>true,
              'headers'=>array('Content-Type'=>'application/json','x-crm-timestamp'=>$stamp,
                'x-crm-signature'=>hash_hmac('sha256',$stamp.'.'.$row->payload,$config['secret'])), 'body'=>$row->payload));
            $code=is_wp_error($response)?0:wp_remote_retrieve_response_code($response);
            $body=is_wp_error($response)?null:json_decode(wp_remote_retrieve_body($response),true);
            $ok=$code===200 && is_array($body) && self::uuid($body['application_id']??'');
            $permanent=in_array($code,array(400,401,403,404,405,409,413,422),true);
            $attempt=(int)$row->attempts+1;
            $status=$ok?'sent':(($permanent || $attempt>=15)?'error':'pending');
            $delay=min(3600,60*(2**min($attempt-1,6)));
            if ($code===429) $delay=max($delay,min(3600,(int)wp_remote_retrieve_header($response,'retry-after')));
            $wpdb->update($table,array('status'=>$status,'last_code'=>$ok?'200':('http_'.$code),
              'updated_at'=>gmdate('Y-m-d H:i:s'),'next_attempt'=>gmdate('Y-m-d H:i:s',time()+$delay)),array('event_id'=>$row->event_id));
        }
    }
    static function menu() { add_options_page('Porto CRM','Porto CRM','manage_options','porto-crm',array(__CLASS__,'page')); }
    static function save() {
        if (!current_user_can('manage_options')) wp_die('Sin permiso');
        check_admin_referer('porto_crm_save');
        $old=self::config(); $secret=trim(wp_unslash($_POST['secret']??''));
        if ($secret!=='' && (strlen($secret)<32 || strlen($secret)>256 || preg_match('/[\r\n]/',$secret))) wp_die('La clave debe tener entre 32 y 256 caracteres, sin saltos de línea.');
        $secret=$secret!==''?$secret:($old['secret']??'');
        if (!empty($_POST['send']) && $secret==='') wp_die('Primero guardá la clave de conexión.');
        update_option(self::OPTION,array('secret'=>$secret,'capture'=>!empty($_POST['capture']),'send'=>!empty($_POST['send'])),false);
        wp_safe_redirect(admin_url('options-general.php?page=porto-crm&saved=1')); exit;
    }
    static function retry() {
        if (!current_user_can('manage_options')) wp_die('Sin permiso');
        check_admin_referer('porto_crm_retry');
        global $wpdb; $table=self::table();
        $wpdb->query("UPDATE $table SET status='pending',attempts=0,next_attempt=UTC_TIMESTAMP() WHERE status='error'");
        self::work();
        wp_safe_redirect(admin_url('options-general.php?page=porto-crm')); exit;
    }
    static function page() {
        if (!current_user_can('manage_options')) return;
        $c=self::config(); global $wpdb; $table=self::table();
        echo '<div class="wrap"><h1>Conexión Porto CRM</h1><p>Conecta los dos formularios de garantía. Los correos y los envíos de Elementor se conservan.</p>';
        if (get_option('porto_crm_bridge_schema')!=='1') echo '<div class="notice notice-error"><p>No se pudo crear la cola. No actives la conexión.</p></div>';
        $notice=get_option('porto_crm_bridge_notice','');
        if ($notice) echo '<div class="notice notice-warning"><p>'.esc_html($notice).'</p></div>';
        echo '<form method="post" action="'.esc_url(admin_url('admin-post.php')).'">';
        wp_nonce_field('porto_crm_save');
        echo '<input type="hidden" name="action" value="porto_crm_save"><p><label>Clave de conexión (CRM_WEBHOOK_SECRET)<br><input name="secret" type="password" autocomplete="new-password" size="65" value=""></label></p>';
        echo '<p>'.(!empty($c['secret'])?'Hay una clave guardada. Dejá el campo vacío para conservarla.':'Todavía no hay una clave guardada.').'</p>';
        echo '<p><label><input type="checkbox" name="capture" value="1" '.checked(!empty($c['capture']),true,false).'> Capturar los dos formularios en la cola</label></p>';
        echo '<p><label><input type="checkbox" name="send" value="1" '.checked(!empty($c['send']),true,false).'> Enviar los pendientes al CRM</label></p>';
        submit_button('Guardar configuración'); echo '</form><h2>Estado de los envíos</h2>';
        echo '<p>Pendiente: espera envío. Enviado: confirmado por CRM. Error: requiere reintento. Revisión: datos o identificadores inválidos; consultar el original en Elementor → Envíos.</p>';
        if (get_option('porto_crm_bridge_schema')==='1') {
            $counts=$wpdb->get_results("SELECT status,COUNT(*) AS total FROM $table GROUP BY status");
            foreach ($counts as $count) echo '<p>'.esc_html($count->status).': <strong>'.(int)$count->total.'</strong></p>';
            $errors=$wpdb->get_results("SELECT event_id,last_code FROM $table WHERE status IN ('error','review') ORDER BY created_at DESC LIMIT 10");
            foreach ($errors as $error) echo '<p><code>'.esc_html($error->event_id).' · '.esc_html($error->last_code).'</code></p>';
        }
        echo '<form method="post" action="'.esc_url(admin_url('admin-post.php')).'">'; wp_nonce_field('porto_crm_retry');
        echo '<input type="hidden" name="action" value="porto_crm_retry">'; submit_button('Reintentar errores y procesar pendientes','secondary');
        echo '</form><p>La cola se procesa con WP-Cron. Configurá una tarea programada del hosting cada minuto para asegurar los envíos aunque no haya visitas. No hay envío de WhatsApp.</p></div>';
    }
    static function browser() {
        if (empty(self::config()['capture'])) return;
        /* PORTO_BROWSER_SCRIPT */
    }
}
Porto_CRM_Elementor_Bridge_V1::boot();
