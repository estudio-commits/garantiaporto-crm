from pathlib import Path
root=Path(__file__).resolve().parent
php=(root/'bridge.php').read_text()
js=(root/'browser.js').read_text()
assert '</script' not in js.lower()
script="echo <<<'PORTO_BROWSER_V1'\n<script id=\"porto-crm-bridge\">\n"+js+"</script>\nPORTO_BROWSER_V1;"
snippet=php.replace('        /* PORTO_BROWSER_SCRIPT */',script).removeprefix('<?php\n')
(root/'WPCode-Porto-CRM.txt').write_text(snippet)
print('WPCode snippet built; no credentials included.')
