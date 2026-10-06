# dsh-computer-use 鈥?鐢佃剳鎿嶄綔妯″紡

鍦?DeepSeek Harness 涓柊澧炵浜斾釜妯″紡銆岀數鑴戞搷浣滄ā寮忋€嶏細淇濈暀鏍囧噯妯″紡鐨勫叏閮ㄨ兘鍔涳紝骞跺姞涓?*灞忓箷鎴浘**涓?*榧犳爣閿洏鎺у埗**锛岀敤浜庢搷浣滄病鏈?agent 鎺ュ彛鐨勮蒋浠躲€佷互鍙婅鍙栧彧瀛樺湪浜庡睆骞曚笂鐨勪俊鎭€?
## 蹇€熷紑濮?
鍓嶆彁锛歐indows + 宸插畨瑁?DeepSeek Harness 妗岄潰鐗堛€?
**鏂瑰紡涓€锛氫粠 Harness 鐣岄潰瀹夎锛堟帹鑽愶級**

鍦ㄦ彃浠堕〉鐐广€屾坊鍔犳彃浠躲€嶏紝杈撳叆鍖呭悕锛?
```
dsh-computer-use-mode
```

鎴栫洿鎺ヨ緭鍏ヤ粨搴撳湴鍧€锛?
```
https://github.com/EvangeliMo/dsh-computer-use
```

瀹夎鍚?*閲嶅惎 Harness**锛屾柊寤轰换鍔℃椂閫夋嫨銆岀數鑴戞搷浣滄ā寮忋€嶃€?
**鏂瑰紡浜岋細鍏嬮殕鍚庢湰鍦板畨瑁?*

```powershell
git clone https://github.com/EvangeliMo/dsh-computer-use.git
cd dsh-computer-use
powershell.exe -NoProfile -ExecutionPolicy Bypass -File install.ps1
```

瀹夎鑴氭湰浼氳嚜鍔ㄥ畾浣?profile锛堜紭鍏?`desktop`锛涙満鍣ㄤ笂鏈夊涓?profile 涓旀棤 `desktop` 鏃朵細鎶ラ敊瑕佹眰浣犳樉寮忔寚瀹?`-Profile <璺緞>`锛夈€傚厛鐢?`-WhatIf` 绌鸿繍琛屽彲浠ョ湅鍒板畠鎵撶畻鍋氫粈涔堣€屼笉鍐欏叆浠讳綍涓滆タ銆?
**涓嶉渶瑕?`npm install`銆?* 鏈彃浠朵笉澹版槑浠讳綍渚濊禆锛歚koffi`銆乣fflate`銆乣@deepseek-ai/dsh-tools`銆乣@deepseek-ai/schemastery` 閮界敱 Harness 瀹夎鐩綍鎻愪緵锛宍lib/loader.cjs` 浠?`process.resourcesPath` 鎺ㄥ瀹夎浣嶇疆鍘昏В鏋愬畠浠€傚洜姝?*鏃犺浠庣晫闈㈠畨瑁呫€佷粠 npm 瀹夎杩樻槸鍏嬮殕鍒颁换鎰忎綅缃兘鑳藉伐浣?*锛屼篃涓嶄緷璧栫綉缁溿€?
## 杩欎釜妯″紡鎻愪緵浠€涔?
涓や釜宸ュ叿锛?
| 宸ュ叿 | 鐢ㄩ€?|
|---|---|
| `computer` | 鍗曟鎿嶄綔銆傚姩浣滐細`screenshot` / `screen_info` / `windows` / `focus_window` / `click` / `double_click` / `right_click` / `middle_click` / `move` / `drag` / `scroll` / `type` / `shortcut` / `key` / `cursor` / `sleep` / `waitForChange` / `waitUntilStable` |
| `computer_batch` | 涓€娆¤皟鐢ㄦ墽琛屽姝ュ簭鍒楋紙姣忔鍙甫 `sleep` 绛夌晫闈㈢ǔ瀹氾級锛岀敤浜庛€岀偣鍑?鈫?杈撳叆 鈫?鍥炶溅銆嶈繖绫绘満姊拌繛鎷?|

`waitForChange` 涓?`waitUntilStable` 閫氳繃鎸佺画閲囨牱灞忓箷鏉ュ垽鏂晫闈㈡槸鍚﹀凡绋冲畾锛岄伩鍏嶉潬鐚?`sleep` 鏃堕暱銆?
澶栧姞涓€娈电郴缁熸彁绀鸿瘝娈佃惤锛屾敞鍐屽湪 Harness 鑷繁棰勭暀鐨?`TOOL_COMPUTER_USE` 鎻掓Ы锛坥rder 3000锛夛紝璐熻矗璇存槑宸ヤ綔娴佷笌瀹夊叏杈圭晫銆?
## 涓轰綆鍒嗚鲸鐜囪瑙夎緭鍏ヨ璁＄殑瑙傚療娴佺▼

杩欐槸鏈ā寮忕殑鏍稿績璁捐锛岄拡瀵瑰浘鍍忚緭鍏ュ垎杈ㄧ巼鏈夐檺鐨勬ā鍨嬶細

**绗竴姝?鈥?鍏ㄥ眬姒傝銆?* 鍏ㄥ睆鎴浘浼氶檷閲囨牱鍒?1152 鍍忕礌锛?920脳1080 鈫?`scale: 0.6`锛夛紝骞跺湪鍥句笂**鐑у綍鍧愭爣鏍囧昂**锛堟瘡 200 灞忓箷鍍忕礌涓€鏉＄綉鏍肩嚎锛屾瘡 400 鍍忕礌甯︽暟瀛楁爣绛撅級鍜?**1鈥? 璞￠檺缂栧彿**銆傛ā鍨嬩笉闇€瑕佸仛蹇冪畻锛屽潗鏍囩洿鎺ュ啓鍦ㄥ浘閲屻€?
**绗簩姝?鈥?灞€閮ㄥ師鐢熷垎杈ㄧ巼銆?* 鐢?`region` 鍙傛暟閲嶆柊鎴彇涓€涓皬鍖哄煙锛屽彧瑕佹渶闀胯竟涓嶈秴杩?`nativeMaxDimension`锛堥粯璁?1400锛夛紝灏变互 `scale: 1` 鍘熺敓鍒嗚鲸鐜囪繑鍥炩€斺€旀鏃跺浘鍍忓儚绱犲氨鏄睆骞曞儚绱狅紝灏忓瓧瀹屽叏鍙銆?
**`tiles` 鍙傛暟**鍙互鎶婁竴涓緝澶у尯鍩熶竴娆″垏鎴愭渶澶?9 鍧楀師鐢熷垎杈ㄧ巼鍥撅紝鐪佹帀澶氭寰€杩斻€?
鍧愭爣鎹㈢畻瑙勫垯鍙湁涓€涓細`灞忓箷鍧愭爣 = region 鍘熺偣 + 鍥惧儚鍧愭爣 / scale`銆傜粨鏋滈噷 `region`銆乣scale`銆乣size` 姣忔閮芥槑纭洖鎶ャ€?
## 鍏抽敭瀹炵幇绾︽潫锛堟敼鍔ㄥ墠璇峰厛璇伙級

1. **鍧愭爣闆舵崲绠椼€?* 瀹炴祴鎻掍欢瀹夸富杩涚▼ `DPI awareness = 2`锛坧er-monitor锛夈€乣dpi = 120`锛屼笖 `GetSystemMetrics` == `DESKTOPHORZRES` == 1920銆傛埅鍥俱€乣GetCursorPos`銆乣SetCursorPos` 澶╃劧澶勪簬**鍚屼竴涓墿鐞嗗儚绱犵┖闂?*锛屽洜姝ゆ湰鎻掍欢浠庝笉鍋氬潗鏍囩缉鏀俱€傚敮涓€鐨勭缉鏀惧彂鐢熷湪浜ょ粰妯″瀷鐨勫浘鍍忎笂锛屼笖璇ョ郴鏁版槑纭洖鎶ャ€?*涓嶈**寮曞叆鍩轰簬 DPI 鐨勫潗鏍囨崲绠椻€斺€旈偅浼氬紩鍏ユ湰涓嶅瓨鍦ㄧ殑閿欒銆?
2. **蹇呴』鏄?CommonJS銆?* `koffi` 涓?`@deepseek-ai/dsh-tools` 閮藉湪瀹夎鍖呯殑 `app.asar` 鍐呫€傚彧鏈?CommonJS 鐨?`require` 浼氱粡杩?Electron 鐨?asar 鎰熺煡瑙ｆ瀽鍣紱ESM 鐨?bare import 浼氫互 `ERR_MODULE_NOT_FOUND` 澶辫触锛堝凡浠庨儴缃蹭綅缃疄娴嬶級銆傚悓鏃?*涓嶈兘**鎶婅繖浜涘寘澶嶅埗杩涙彃浠剁洰褰曪細閭ｄ細浜х敓绗簩浠?`cordis` 瀹炰緥锛岀牬鍧忔湇鍔¤韩浠姐€傚洜姝ゅ叆鍙ｆ枃浠舵槸 CJS锛屽苟閫氳繃 `lib/loader.cjs` 鐨勫畨瑁呰矾寰勬劅鐭ヨВ鏋愬櫒鍙栧緱瀹夸富妯″潡銆?
3. **PNG 鐨?IDAT 蹇呴』鏄?zlib 娴併€?* `fflate.deflateSync` 杈撳嚭鐨勬槸**瑁?deflate**锛宭ibpng 浼氫互 `vipspng: libpng read error` 鎷掔粷锛涜€岃８ deflate 鐢?`inflateRaw` 鍗磋兘姝ｅ父瑙ｅ紑锛岃繖涓粍鍚堟瀬鍏疯瀵兼€с€傚繀椤荤敤 `fflate.zlibSync`銆傛椤圭粡 A/B 瀵圭収瀹為獙瀹氫綅銆?
4. **鍥剧墖缁?`projectContent` 鎶曢€掋€?* `execute` 鍙兘杩斿洖绾?JSON锛屽浘鐗囧瓧鑺傚繀椤诲厛寮傛钀界洏涓?attachment锛屽啀鐢?`projectContent` 鎸備笂 `{ type: 'image', attachment }` 鍧椻€斺€斾笌 `dsh-mcp-client` 鐩稿悓鐨?seam銆?
## 瀹夎

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File install.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File install.ps1 -WhatIf   # 绌鸿繍琛?```

瀹夎鑴氭湰浼氾細澶囦唤 profile 閰嶇疆鍒板甫鏃堕棿鎴崇殑鐩綍 鈫?鎶婃彃浠?*鐪熷疄澶嶅埗**鍒?`profiles\desktop\node_modules\dsh-computer-use` 鈫?鍦?profile 鐨?`bundles` 閲岃拷鍔?`dsh-computer-use`銆?
**鍒绘剰涓嶄娇鐢?junction**锛氬簲鐢ㄧ殑閲嶅惎鎭㈠娴佺▼锛?绂佺敤绗笁鏂规彃浠躲€佸浠?profile 琛ヤ竵銆侀噸鍚?锛変細璺熼殢 junction 骞跺垹闄ゅ叾鐩爣锛屾鍓嶆浘鍥犳鎹熸瘉鎻掍欢婧愮爜銆?
**涓嶄慨鏀瑰畨瑁呯洰褰曞唴浠讳綍鏂囦欢**锛屽洜姝?Harness 鍗囩骇鎴栭噸瑁呴兘涓嶄細鍐叉帀鏈彃浠躲€?
### 鈿狅笍 profile manifest 鐨?BOM 浼氱洿鎺ュ鑷村惎鍔ㄥ穿婧?
`~/.dsh/profiles/desktop/package.json` 鏄ā寮忔竻鍗曪紝dsh-host 鐢ㄨ８ `JSON.parse()` 璇诲彇瀹冦€?*鍙鏂囦欢寮€澶存湁 UTF-8 BOM锛坄EF BB BF`锛夛紝host 灏卞湪鍚姩鏃╂湡鎶?`Unexpected token '\uFEFF'` 骞剁珛鍒婚€€鍑?*锛屽脊绐楁樉绀?搴旂敤鏃犳硶鍚姩鎴栧凡鎰忓鍋滄"锛岃€屽脊绐楀缓璁殑"閲嶆柊瀹夎"**瀹屽叏鏃犳晥**鈥斺€旈噸瑁呭彧瑕嗙洊绋嬪簭鐩綍锛屼笉纰?`~/.dsh`銆?
鏈彃浠剁殑 `install.ps1` 绗竴鐗堣俯杩囪繖涓潙锛氬畠鐢?`Set-Content -Encoding UTF8` 鍥炲啓娓呭崟锛岃€?Windows PowerShell 5.1 涓嬭 cmdlet **蹇呭畾鍐欏叆 BOM**銆傜幇宸叉敼涓?
```powershell
[System.IO.File]::WriteAllText($path, $json, (New-Object System.Text.UTF8Encoding($false)))
```

骞跺湪鍐欏叆鍚庣珛鍗虫鏌ュ墠涓夊瓧鑺傦紝鍙戠幇 BOM 灏辨姏閿欎腑姝€?*鏀瑰姩鍐欐竻鍗曠殑浠ｇ爜鏃讹紝涓嶈鎹㈠洖 `Set-Content` / `Out-File`銆?*

鍐嶆宕╂簝鏃剁殑搴旀€ヤ慨澶嶏細

```powershell
$p = "$env:USERPROFILE\.dsh\profiles\desktop\package.json"
$t = [System.IO.File]::ReadAllText($p, [System.Text.Encoding]::UTF8).TrimStart([char]0xFEFF)
[System.IO.File]::WriteAllText($p, $t, (New-Object System.Text.UTF8Encoding($false)))
```

### 鍥炴粴

```powershell
Copy-Item '<backup-dir>\*' "$env:USERPROFILE\.dsh\profiles\desktop" -Force
Remove-Item "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-computer-use" -Recurse -Force
```

## 娴嬭瘯

闇€瑕佷互瀹夸富杩愯鏃舵墽琛岋紝浠ヤ繚璇佹ā鍧楄В鏋愪笌鐢熶骇涓€鑷达細

```powershell
$dsh = "D:\Apps\Deepseek Harness\DeepSeek Harness.exe"   # 娉ㄦ剰锛氱洰褰曞悕鍚┖鏍?$env:ELECTRON_RUN_AS_NODE="1"
& $dsh scripts\test-native.cjs       # 鍘熺敓灞?20 椤?& $dsh scripts\test-plugin.cjs       # 鎻掍欢灞?21 椤?& $dsh scripts\verify-deployed.cjs   # 閮ㄧ讲鍓湰瀹炶浇
& $dsh scripts\check-patch-refs.cjs  # preset 寮曠敤鐨勫寘鍚嶆槸鍚﹂兘瀛樺湪
```

`test-native.cjs` 鍙Щ鍔ㄩ紶鏍囥€佷笉鐐瑰嚮銆佷笉杈撳叆锛屽洜姝ゅ彲浠ュ畨鍏ㄨ繍琛屻€傛祴璇曚骇鍑虹殑 PNG 鍦?`test-output/`锛屽彲鐢?`read_image` 鏌ョ湅鏍囧昂涓庤薄闄愭爣娉ㄦ晥鏋溿€?
`check-patch-refs.cjs` 闇€瑕佷紶鍏?asar 璺緞锛屼緥濡傦細
`node scripts\check-patch-refs.cjs "D:\Apps\Deepseek Harness\resources\app.asar" cordis.patch.yml`
瀹冨彲浠ユ彁鍓嶅彂鐜?preset 閲屽啓閿欑殑鍖呭悕鈥斺€旇繖绫婚敊璇細璁?bundle 鍔犺浇澶辫触銆備綔涓哄鐓э紝瀹樻柟 `standard.patch.yml` 璺戝悓涓€妫€鏌ヤ篃閫氳繃銆?
## 瀹炴祴缁撹锛堝涓昏繘绋嬪唴锛岀敤甯︽棩蹇楃殑绐椾綋鎺㈤拡楠岃瘉锛?
鐢ㄤ竴涓嚜甯︽棩蹇楃殑 WinForms 鎺㈤拡褰撻澏瀛愶紝瀹冩妸鑷繁鏀跺埌鐨勬瘡涓€娆＄偣鍑汇€佹瘡涓€涓瓧绗︺€佹瘡涓€娆℃粴杞啓鍏ユ棩蹇楁枃浠垛€斺€?鎿嶄綔鏄惁鐪熺殑鐢熸晥"闈犳枃浠惰瘉鎹紝涓嶉潬鐚溿€?
### 鉁?杈撳叆娉ㄥ叆瀹屽叏鍙敤

| 鍔熻兘 | 璇佹嵁 |
|---|---|
| 榧犳爣绉诲姩 | 璇锋眰 (600,700)锛屽洖璇诲厜鏍囪惤鍦ㄧ墿鐞?(600,700) |
| 鍗曞嚮 / 鍙抽敭 / 鍙屽嚮 | 绐椾綋璁板綍 `MOUSE Left @client 310,152`锛屼笌璇锋眰鍧愭爣鍚诲悎 |
| 鎷栨嫿 | 鎷栨爣棰樻爮锛岀獥鍙ｄ粠 (450,288) 绉诲埌 (322,220)锛屼綅绉讳笌璇锋眰涓€鑷?|
| 婊氳疆 | `WHEEL delta=240 / -240` |
| 鑻辨枃/鏁板瓧/绗﹀彿 | 33 涓瓧绗﹀叏閮ㄦ纭?|
| **涓枃 Unicode** | 鐢?鑴?鎿?浣?娴?璇?锛?浣?濂?锛?涓?鐣?鍏ㄩ儴姝ｇ‘锛屽惈鍏ㄨ鏍囩偣 |
| 鍥炶溅 / 閫€鏍?| 鍥炶溅鎻愪氦瀹屾暣鏁磋銆侀€€鏍?`U+0008` |
| 缁勫悎閿?| `ctrl+shift+a`锛屼慨楗伴敭鐘舵€佹纭笂鎶?|
| 鎸夐敭杩炲彂 | 鍙虫柟鍚戦敭 脳3锛屾伆濂?3 娆′簨浠?|
| 绐楀彛鏋氫妇 / 鑱氱劍 | 姝ｇ‘璇诲嚭鐪熷疄鏍囬骞舵垚鍔熺疆椤?|

> 鈿狅笍 **鎴戞鍓嶅叧浜庤緭鍏ユ敞鍏ョ殑缁撹鏄敊鐨勩€?* 鎴戞浘鎶ュ憡 `SetCursorPos` 杩斿洖 `false`銆佷簨浠跺埌涓嶄簡绯荤粺锛屽苟鎺ㄦ祴鏄护鐗屾垨绛栫暐鎷︽埅銆傜湡瀹炲師鍥犳槸鎴?*鍦ㄦ矙绠卞寲鐨?shell 閲屽仛鐨勮瘖鏂?*鈥斺€斿彈闄愪护鐗屾棤娉曟搷浣滆緭鍏ユ闈€傜湡瀹炲涓昏繘绋嬶紙姝ｅ父浠ょ墝锛夋病鏈変换浣曢棶棰樸€?*涓嶈鎶婃矙绠卞唴娴嬪埌鐨?Win32 澶辫触褰撲綔浜у搧缂洪櫡銆?*

### 馃搻 涓夊鍧愭爣绌洪棿锛堝凡鐢ㄥ儚绱犵骇姣斿纭锛?
鏈幆澧冩湁 **125% 鏄剧ず缂╂斁**锛岀晫闈㈤噷鍚屾椂瀛樺湪涓変釜鍧愭爣绯伙細

| 鍧愭爣绯?| 灏哄 | 璋佸湪鐢?|
|---|---|---|
| 鐗╃悊鍍忕礌 | 1920脳1080 | `computer` 宸ュ叿銆丟DI 鎴浘銆乣GetSystemMetrics` |
| 閫昏緫鍍忕礌 | 1536脳864锛埫?.8锛?| 鏅€?32 浣嶆湭澹版槑 DPI 鎰熺煡鐨勭▼搴?|
| 鎴浘鍥惧儚 | 绛変簬宸ュ叿鐨勫潗鏍?| 1:1 瀵瑰簲 `computer` 鐨勫潗鏍?|

楠岃瘉鏂规硶锛氭妸鎺㈤拡绐椾綋娑傛垚鍝佺孩鑹诧紝鍦ㄦ埅鍥鹃噷閲忓嚭鍖呭洿鐩掞紝鍐嶇畻鍑哄叾鐪熷疄灞忓箷浣嶇疆锛屼袱杈规瘮瀵广€?
**缁撹锛氬湪鎴浘閲岄噺鍒扮殑鍍忕礌鐐瑰彲浠ョ洿鎺ュ綋 `click` 鍧愭爣鐢紝鏃犻渶鎹㈢畻銆?* 鍥犱负鎴浘涓庡伐鍏峰悓澶勭墿鐞嗗儚绱犵┖闂达紝鑰岃緭鍏ユ敞鍏ヤ篃鍦ㄧ墿鐞嗗儚绱犵┖闂达紙瀹夸富杩涚▼鏄?per-monitor DPI aware锛夈€傚彧鏈夊綋鎿嶄綔鐩爣鏄湭澹版槑 DPI 鎰熺煡鐨勮€佺▼搴忋€佷笖闇€瑕佹寜"瀹冭嚜宸辩殑閫昏緫鍧愭爣"涓嬪垽鏂椂锛屾墠闇€瑕?脳0.8銆?
### 鍥惧儚濡備綍閫佽繘妯″瀷锛堟渶瀹规槗韪╅敊鐨勪竴鐜級

鍥惧儚缁?**`output.render`**锛堝悓姝ワ級鎶曢€掞紝涓旈檮浠跺紩鐢ㄥ繀椤讳綔涓?*鍙灇涓剧殑鏅€?JSON 瀛楁鍐欏湪杈撳嚭鍊煎唴閮?*锛坄images` 鏁扮粍锛屽凡鍦?output schema 閲屽０鏄庯級銆?
杩欎笉鏄鏍奸€夋嫨锛屾槸琚皟搴﹀櫒鐨勬墽琛岄『搴忓己鍒剁殑銆俙dsh-tools` 鐨勯『搴忔槸锛?
```js
const detached = snapshotToolValue(tool.name, candidate); // JSON 寰€杩斿揩鐓?const value = deepFreeze(detached);                        // 娣卞喕缁?rendered = tool.output.render(exec.arguments, value);      // 鏈€鍚庢墠 render
```

**`render` 鎷垮埌鐨勪笉鏄?`execute` 杩斿洖鐨勯偅涓璞★紝鑰屾槸瀹冪殑 JSON 蹇収鐨勫喕缁撳壇鏈€?* 鍥犳锛?
- 鐢?`Symbol` 灞炴€ф寕杞?鈫?蹇収鏃惰鍓ユ帀
- 鐢?`WeakMap` 浠ヨ繑鍥炲€间负閿?鈫?閿璞″凡琚浛鎹紝鏌ヤ笉鍒?- 鐢?`projectContent`锛堟渶鍒濈殑鍋氭硶锛夆啋 璋冨害鍣ㄤ笉鏌ヨ繖鏉¤矾寰?
涓夌鍋氭硶閮借〃鐜颁负**鍚屼竴涓瀬鍏疯瀵兼€х殑鐥囩姸**锛氭枃瀛楄鏄庢甯稿埌杈撅紙"宸叉崟鑾?1920脳1080 鍥惧儚"锛夛紝**浣嗗浘鍍忎粠鏈繘鍏ユā鍨嬩笂涓嬫枃**銆傛ā鍨嬩簬鏄細鎻忚堪涓€涓畠娌＄湅瑙佺殑灞忓箷銆?
`read_image` 涔嬫墍浠ュ彲闈狅紝姝ｆ槸鍥犱负瀹冩妸寮曠敤鏀惧湪 `value.image` 閲屸€斺€斿彲鏋氫妇銆佸湪 schema 鍐呫€佽兘杩囧揩鐓с€?
**鏀瑰姩姝ゅ鏃惰杩愯 `test-plugin.cjs` 鐨?`the image reference SURVIVES the dispatcher snapshot` 鐢ㄤ緥**锛屽畠澶嶅埢浜嗗揩鐓?鍐荤粨閾捐矾锛屼换浣曡蛋鏃佽矾鐨勫仛娉曢兘浼氬綋鍦哄け璐ャ€?
### 杈撳嚭 schema 閲岀殑瀛楁涓嶄細鑷姩閫佽揪妯″瀷

鍚屼竴涓満鍒剁殑鍙︿竴闈細**妯″瀷鐪嬪埌鐨勫唴瀹瑰畬鍏ㄧ敱 `output.render` 鍐冲畾銆?* schema 鏍￠獙鍙繚璇佸€煎悎娉曪紱`windows`銆乣steps` 杩欑被鏁扮粍鍗充娇澹版槑浜嗐€佸～浜嗗€硷紝濡傛灉 `render` 娌℃妸瀹冧滑鎵撳嵃杩涙枃鏈潡锛屾ā鍨嬪氨鏀朵笉鍒般€?
鐥囩姸寰堥殣钄斤細agent 浼氱煡閬?鎵惧埌 5 涓獥鍙?锛屽嵈**璇翠笉鍑哄叾涓换浣曚竴涓殑鍚嶅瓧**銆?
鎵€浠ュ嚒鏄缁欐ā鍨嬬湅鐨勬暟鎹紝閮藉繀椤诲嚭鐜板湪 `render` 鐨勮緭鍑洪噷锛?
| 鍔ㄤ綔 | render 涓繀椤诲寘鍚?|
|---|---|
| `windows` | 瀹屾暣鍒楄〃锛坔andle / 灏哄 / 浣嶇疆 / 鏍囬锛夛紝鑰屼笉鍙槸鏁伴噺 |
| `computer_batch` | 姣忔缁撴灉鎽樿锛坄cursor` 鍧愭爣銆乣screen_info` 鏁板€肩瓑锛夛紝鑰屼笉鍙槸"瀹屾垚 3 涓姩浣? |
| `screen_info` / `cursor` | 鍑犱綍鏁板€间笌鎸囬拡浣嶇疆 |
| `screenshot` | 鏂囧瓧璇存槑 + 鐢?`images` 鏁扮粍杞崲鐨勫浘鍍忓潡 |

`test-plugin.cjs` 鐨?`windows action RENDERS the list, not just counts it` 涓撻棬瀹堣繖鏉★細瀹冮€愭潯鏍稿姣忎釜绐楀彛鐨?handle 涓庢爣棰橀兘鍑虹幇鍦ㄦ覆鏌撴枃鏈腑銆?
### 绐楀彛鎴浘鐨勮竟妗嗭細蹇呴』鐢?DWM 杈规

`GetWindowRect` 鍖呭惈 DWM 淇濈暀鐨?*涓嶅彲瑙佽皟鏁磋竟妗?*锛堟瘡杈圭害 8px锛夛紝鎸夊畠瑁佸壀浼氬湪鍙充晶鍜屼笅鏂圭暀涓嬮粦杈广€俙DWMWA_EXTENDED_FRAME_BOUNDS` 杩斿洖鐨勬墠鏄敤鎴风湅寰楄鐨勮竟妗嗐€?
`windows` 鎶ュ憡涓庣獥鍙ｆ埅鍥?*閮?*浣跨敤 DWM 杈规锛堢粡 `visibleBounds()`锛夛紝涓よ€呭繀椤讳竴鑷粹€斺€斿惁鍒欏潗鏍囪鏁颁細瀵逛笉涓婏紝娴嬭瘯 `window capture matches the DWM frame, not GetWindowRect` 浼氬け璐ャ€?
### 绐楀彛鏋氫妇鐨勮繃婊よ鍒?
`IsWindowVisible` 浼氭斁杩囧ぇ閲忓菇鐏电獥鍙ｏ細IME 闅愯棌绐楀彛锛堝悓涓€鏍囬閲嶅 4-5 娆★級銆乁WP 宸叉寕璧风獥鍙ｃ€侀浂闈㈢Н鐨勯€氱煡绐楀彛銆傝繃婊ら摼锛?
1. `IsWindowVisible` 鈥?鍩虹鍙鎬?2. `DWMWA_CLOAKED` 鈥?DWM 鏍囪涓哄鐢ㄦ埛闅愯棌锛圲WP 鎸傝捣銆両ME 鍊欓€夌獥锛?3. `WS_EX_TOOLWINDOW` 鈥?宸ュ叿闈㈡澘绫荤獥鍙?4. 绌烘爣棰?5. **闆堕潰绉?* 鈥?`495x0` 杩欑被涓嶆槸鏈夋晥鎴浘鐩爣
6. **绂诲睆** 鈥?瀹屽叏涓嶅湪铏氭嫙妗岄潰鑼冨洿鍐?
娉ㄦ剰**涓嶈繃婊?* `WS_EX_NOREDIRECTIONBITMAP`锛圙PU 鍚堟垚绐楀彛锛夛細DSH 鑷繁鐨勭獥鍙ｅ氨甯﹁繖涓爣蹇楋紝杩囨护鎺夊畠浼氳 agent 鏃犳硶鏌ョ湅鑷繁鎵€鍦ㄧ殑瀹夸富绋嬪簭銆傝繖绫荤獥鍙ｄ細琚爣璁颁负 `gpu-composited` 骞跺湪鏂囧瓧閲屾彁绀?鐩存帴鎴浘鍙兘杩斿洖绌虹櫧锛屾敼鎴睆骞曞尯鍩?銆傚疄娴嬩腑 DSH 绐楀彛璧扮殑鏄睆骞曞洖閫€璺緞锛岃兘姝ｅ父鐪嬪埌鍐呭銆?
### 鍒嗚鲸鐜囩瓥鐣ワ細涓嶅仛棰勯槻鎬ч檷閲囨牱

鍥惧儚鐢?*妯″瀷鑷繁**涓嬮噰鏍凤紝鎵€浠ユ湰鎻掍欢**榛樿浠ュ睆骞曠湡瀹炲垎杈ㄧ巼浜や粯**鈥斺€?920脳1080 鐨勬闈㈠氨閫?1920脳1080 鐨勫浘锛宎gent 鑷繁鍐冲畾瑕佺湅鍝潡銆佽涓嶈灞€閮ㄦ斁澶с€?
鏃╂湡鐗堟湰浼氫富鍔ㄦ妸鍏ㄥ睆鍘嬪埌 1152px锛坰cale 0.6锛夛紝杩欐槸鍩轰簬"妯″瀷鍥惧儚杈撳叆鍒嗚鲸鐜囦綆銆侀渶瑕佸厛缂╁皬"鐨?*閿欒鍓嶆彁**銆備唬浠锋槸涓㈠純浜嗙粏鑺傦紝鑰屾ā鍨嬫湰鏉ュ彲浠ヨ嚜宸卞喅瀹氫繚鐣欏灏戙€?
`fullMaxDimension`锛堥粯璁?4096锛夌幇鍦ㄦ槸**瀹夊叏涓婇檺鑰岄潪鐩爣**锛屽彧鍦ㄨ櫄鎷熸闈㈠紓甯稿ぇ鏃舵墠鐢熸晥銆俙scale` 鍙傛暟浠嶅彲鐢紝浣嗙敤浜?鎴戝氨鏄兂瑕佷竴寮犲皬鍥?杩欑鏄庣‘闇€姹傘€?
鍧愭爣鏍囧昂涓庤薄闄愭爣璁颁繚鐣欙細瀹冧滑瑙ｅ喅鐨勬槸鍙︿竴涓棶棰樷€斺€?*鍛婅瘔 agent 鏌愪釜涓滆タ鍦ㄥ摢**锛岃€屼笉鏄渷 token銆?
### 宸茬煡闄愬埗

1. **鍓嶅彴鍛戒护鍚姩鐨?GUI 杩涚▼浼氳鍥炴敹銆?* 鐢?`Start-Process` 寮瑰嚭鐨勭獥鍙ｅ湪鍛戒护缁撴潫鍚庨殢涔嬫秷澶便€傝璁?agent 甯搁┗鎿嶄綔鏌愪釜 GUI 绋嬪簭锛屽繀椤荤敤**鍚庡彴浠诲姟**鍚姩锛屼笉鑳介殢鎵?`Start-Process`銆?2. **UAC / 瀹夊叏妗岄潰鎴笉鍒?*锛屼篃鏃犳硶鍚戞彁鏉冪獥鍙ｆ敞鍏ヨ緭鍏ワ紙UIPI锛夈€?3. **鏃犻檮浠舵湇鍔℃椂闄嶇骇**锛氭埅鍥句粛浼氳惤鐩樺苟鍦ㄦ枃瀛楅噷璇存槑鍘熷洜涓庢枃浠惰矾寰勶紝鍙敤 `read_image` 鍏滃簳璇诲彇銆?
## 閰嶇疆椤?
鍦?`cordis.patch.yml` 鐨?`preset-computer` 鈫?`computer-use.config` 涓嬭皟鏁达細

| 瀛楁 | 榛樿 | 鍚箟 |
|---|---|---|
| `enabled` | `true` | 鎬诲紑鍏?|
| `thumbnailMaxDimension` | `1152` | 鍏ㄥ睆姒傝鍥炬渶闀胯竟锛?920 灞忓搴?scale 0.6 |
| `nativeMaxDimension` | `1400` | 鍖哄煙鎴浘瓒呰繃姝ゅ€兼墠闄嶉噰鏍?|
| `pngLevel` | `6` | PNG deflate 绾у埆 1鈥? |
| `maxBatchActions` | `40` | 鍗曟 `computer_batch` 鐨勫姩浣滀笂闄?|
| `outputDirectory` | `''` | 鎴浘钀界洏鐩綍锛涚暀绌虹敤绯荤粺涓存椂鐩綍 |

## 鏂囦欢缁撴瀯

```
dsh-computer-use/
鈹溾攢鈹€ package.json          # type: commonjs锛堝繀椤伙級
鈹溾攢鈹€ cordis.patch.yml      # 鎸傝浇鎻掍欢 + 澹版槑 preset-computer
鈹溾攢鈹€ install.ps1           # 瀹夎鑴氭湰
鈹溾攢鈹€ lib/
鈹?  鈹溾攢鈹€ index.js          # 鎻掍欢涓讳綋锛氫袱涓伐鍏?+ 鎻愮ず璇嶆钀?鈹?  鈹斺攢鈹€ loader.cjs        # 瀹夎璺緞鎰熺煡鐨勬ā鍧楄В鏋愶紙绌块€?asar锛?鈹溾攢鈹€ src/
鈹?  鈹溾攢鈹€ win32.cjs         # koffi 缁戝畾 user32/gdi32/dwmapi
鈹?  鈹溾攢鈹€ capture.cjs       # GDI 鎴睆
鈹?  鈹斺攢鈹€ png.cjs           # 鑷寘鍚?PNG 缂栫爜鍣?+ 鏍囧昂 + 璞￠檺
鈹斺攢鈹€ scripts/
    鈹溾攢鈹€ test-native.cjs        # 鍘熺敓灞?20 椤?    鈹溾攢鈹€ test-plugin.cjs        # 鎻掍欢灞?38 椤?    鈹溾攢鈹€ verify-deployed.cjs    # 閮ㄧ讲鍓湰 vs 婧愮爜閫愬瓧鑺傛瘮瀵?+ 瀹炶浇
    鈹斺攢鈹€ check-patch-refs.cjs   # preset 寮曠敤鐨勫寘鍚嶆槸鍚﹂兘瀛樺湪
```

## 浠庢矙绠卞唴鎺ㄩ€佷唬鐮佹椂鐨勪袱涓潙

DSH 鐨勬矙绠变細闅旂 Windows 鐨?TLS 鍑嵁瀛樺偍锛屽洜姝ゅ湪娌欑閲屾墽琛?`git push` 浼氶亣鍒颁袱涓?*鐪嬩技缃戠粶鏁呴殰銆佸疄涓虹幆澧冮檺鍒?*鐨勬姤閿欙細

| 鐜拌薄 | 鍘熷洜 | 澶勭悊 |
|---|---|---|
| `curl https://github.com` 杩斿洖 `000` | schannel 鎷夸笉鍒板嚟鎹?| 鐢?OpenSSL 鍚庣 |
| `schannel: AcquireCredentialsHandle failed: SEC_E_NO_CREDENTIALS` | 鍚屼笂 | 鍚屼笂 |

浣?*缃戠粶鏈韩娌℃湁琚皝**鈥斺€擿http://` 鏄庢枃璇锋眰姝ｅ父锛屽埌 `github.com:443` 鐨?TCP 杩炴帴涔熼€氥€傚彧鏈?Windows 鍘熺敓 TLS锛坰channel锛夌殑鍑嵁瀛樺偍涓嶅彲杈俱€侴it for Windows 鑷甫 OpenSSL 涓?CA 璇佷功鍖咃紝缁曞紑鍗冲彲锛?
```powershell
git -c http.sslBackend=openssl push -u origin main
```

璇婃柇鏃舵敞鎰忓尯鍒?杩炰笉涓?鍜?浠撳簱涓嶅瓨鍦?锛?- `Failed to connect` / `SEC_E_NO_CREDENTIALS` 鈫?TLS 鍚庣闂
- `remote: Repository not found.` 鈫?TLS 宸查€氾紝鍙槸 GitHub 涓婅繕娌″缓浠撳簱锛堣璇佸け璐ヤ細鎶?`authentication failed`锛屼笉鏄繖鍙ワ級

鍦?*鏅€氱粓绔?*閲岋紙闈炴矙绠憋級閫氬父涓嶉渶瑕佽繖涓弬鏁帮紝schannel 鍙甯稿伐浣溿€?