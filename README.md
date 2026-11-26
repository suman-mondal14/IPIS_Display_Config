# IPIS_Display_Config

Embedded Configuration & Diagnostic Webserver for **Topgrip IPIS Display Boards** (RDSO SPN/TC/108 compliant).

Each display board's Mini PC runs this Node.js Express service on **port `80`** (with automatic fallback to `8080` if port `80` is occupied or restricted). It serves a web UI to inspect board diagnostics, sync configuration with the Central Data Controller (CDC at `http://10.0.0.253:20000`), and update the board's Platform Number and Windows Static IP (`netsh`).

Using the bundled **NSSM (`nssm.exe`)** and `install_service.bat`, the app runs as a **Windows Background Service (`IPIS_Display_Config`)** that starts **automatically on PC boot** (even before any user logs in) with Administrator/System privileges.

---

## Multi-Display Deployment Examples

Every display Mini PC runs the **same codebase**—only its Windows Ethernet IP and `data/board_config.json` identify which display it is:

| Display Board | `boardType` | `platformNo` (Example) | Static IP (`boardIp`) | Web UI URL |
| :--- | :--- | :--- | :--- | :--- |
| **VDB** (Video Display Board) | `VDB` | `1` | `10.0.0.31` | `http://10.0.0.31` |
| **AVDB** (Arrival/Departure VDB) | `AVDB` | `1` | `10.0.0.81` | `http://10.0.0.81` |

> **Important:** `boardType` is **read-only** in the web UI (`public/index.html`). Set the correct `boardType` (`"VDB"`, `"AVDB"`, `"PDBD"`, etc.) in `data/board_config.json` (or push it from the CDC master) during initial setup of each Mini PC.

---

## Prerequisites (New Windows Mini PC)

- **OS:** Windows 10 / Windows 11 (64-bit) with Administrator access
- **Network:** Ethernet LAN connected to the IPIS `10.0.0.x` network (Subnet Mask `255.255.255.0`, Gateway `10.0.0.1`)
- **Software:** Node.js LTS (64-bit), plus Git (if cloning directly on the Mini PC)

---

## Step-by-Step Installation on a New Mini PC

Follow these steps on **each** new Mini PC (once for **VDB `10.0.0.31`**, once for **AVDB `10.0.0.81`**, etc.).

### Step 1: Install Node.js

`install_service.bat` expects Node.js to be installed in the default Windows path:
`C:\Program Files\nodejs\node.exe`

1. Download the **Node.js LTS (Windows Installer `.msi`, 64-bit)** from [nodejs.org](https://nodejs.org/).
2. Run the installer with **default settings** (do not change the installation path from `C:\Program Files\nodejs\`).
3. Open **Command Prompt** or **PowerShell** and verify:
   ```powershell
   node -v
   npm -v
   where.exe node
   ```
   Confirm `where.exe node` outputs `C:\Program Files\nodejs\node.exe`.

> **Offline Mini PC?** Copy the Node.js `.msi` installer onto a USB drive and install it manually on the Mini PC.

---

### Step 2: Set the Mini PC's Static IP Address

Assign the Mini PC its static IP on the `10.0.0.x` subnet **before** starting the service.

#### Option A: Via PowerShell / Command Prompt (Run as Administrator)

First check your Ethernet adapter name (commonly `Ethernet`):
```cmd
netsh interface show interface
```

Then set the static IP for the target display:

- **For VDB (`10.0.0.31`):**
  ```cmd
  netsh interface ipv4 set address name="Ethernet" static 10.0.0.31 255.255.255.0 10.0.0.1
  ```
- **For AVDB (`10.0.0.81`):**
  ```cmd
  netsh interface ipv4 set address name="Ethernet" static 10.0.0.81 255.255.255.0 10.0.0.1
  ```

*(Replace `"Ethernet"` if your adapter has a different name such as `"Ethernet 2"`.)*

#### Option B: Via Windows GUI
1. Press `Win + R`, type `ncpa.cpl`, and press **Enter**.
2. Right-click your active LAN adapter -> **Properties** -> select **Internet Protocol Version 4 (TCP/IPv4)** -> **Properties**.
3. Select **Use the following IP address** and enter:
   - **IP address:** `10.0.0.31` (for VDB) **or** `10.0.0.81` (for AVDB)
   - **Subnet mask:** `255.255.255.0`
   - **Default gateway:** `10.0.0.1`
4. Click **OK** to save.

---

### Step 3: Place Project Files & Install Dependencies

`install_service.bat` is configured for `D:\IPIS_Display_Config`.

#### If the Mini PC has a `D:\` drive (Recommended — matches `install_service.bat` defaults)
1. Clone or copy the project into `D:\IPIS_Display_Config`:
   ```powershell
   D:
   git clone https://github.com/suman-mondal14/IPIS_Display_Config.git D:\IPIS_Display_Config
   cd D:\IPIS_Display_Config
   ```
2. Install Node.js dependencies (`express`, `axios`, `bcryptjs`):
   ```powershell
   npm install
   ```

> **Offline Mini PC (No Internet)?** Run `npm install` on a connected PC first, then copy the entire `IPIS_Display_Config` folder (including `node_modules\`) via USB to `D:\IPIS_Display_Config` on the Mini PC.

#### If the Mini PC only has a `C:\` drive
1. Place the project at `C:\IPIS_Display_Config` and run `npm install` inside it.
2. Open `install_service.bat` in Notepad and change line 11 from:
   ```bat
   set APP_DIR=D:\IPIS_Display_Config
   ```
   to:
   ```bat
   set APP_DIR=C:\IPIS_Display_Config
   ```

---

### Step 4: Configure `data\board_config.json` for the Display

Because `data/` is excluded in `.gitignore`, a fresh clone does not contain `data\board_config.json`.
If `data\board_config.json` is missing, the server auto-creates a default file on first launch with `boardType: "PDBD"` and default OEM password `admin123`.

To configure the exact display type (**VDB** or **AVDB**):

1. Create the `data` folder (if it does not exist) and generate a bcrypt password hash for your OEM admin password (for example `admin123`):
   ```powershell
   mkdir data -Force
   node -e "const bcrypt = require('bcryptjs'); console.log(bcrypt.hashSync('admin123', 10));"
   ```
   Copy the generated `$2b$10$...` hash string.

2. Create `data\board_config.json` using one of the configurations below (replace `adminPasswordHash` with your generated hash):

   **For VDB (`10.0.0.31`):**
   ```json
   {
     "boardType": "VDB",
     "platformNo": "1",
     "boardIp": "10.0.0.31",
     "adminPasswordHash": "<PASTE_YOUR_BCRYPT_HASH_HERE>",
     "lastTestStatus": "ALL OK (0 Fault)",
     "lastTestTime": "N/A"
   }
   ```

   **For AVDB (`10.0.0.81`):**
   ```json
   {
     "boardType": "AVDB",
     "platformNo": "1",
     "boardIp": "10.0.0.81",
     "adminPasswordHash": "<PASTE_YOUR_BCRYPT_HASH_HERE>",
     "lastTestStatus": "ALL OK (0 Fault)",
     "lastTestTime": "N/A"
   }
   ```

*(Alternatively, run `node index.js` once, press `Ctrl + C` to stop it, and edit the auto-created `data\board_config.json` to change `boardType`, `platformNo`, and `boardIp`.)*

---

### Step 5: Allow Port 80 Through Windows Firewall

Open **Command Prompt or PowerShell as Administrator** and allow inbound HTTP traffic on port `80` so engineers and the CDC can reach the web dashboard over the LAN:

```powershell
netsh advfirewall firewall add rule name="IPIS Display Config HTTP (Port 80)" dir=in action=allow protocol=TCP localport=80
```

---

### Step 6: Install the Auto-Start Windows Service (Run on Boot)

1. Navigate to `D:\IPIS_Display_Config` (or your `APP_DIR`).
2. **Right-click `install_service.bat`** and select **Run as administrator**.
   *(Or open Command Prompt **as Administrator**, `cd /d D:\IPIS_Display_Config`, and run `install_service.bat`.)*

What `install_service.bat` configures automatically using `nssm.exe`:
- **Service Name:** `IPIS_Display_Config`
- **Executable:** `C:\Program Files\nodejs\node.exe index.js`
- **Startup Type:** `SERVICE_AUTO_START` (launches automatically when the Mini PC boots)
- **Crash Recovery:** Automatically restarts after `2000 ms` on unexpected exit
- **Logs (5 MB rotation):**
  - `logs\service_out.log`
  - `logs\service_err.log`

> **Note:** Make sure no other app (such as IIS or another web server) is already listening on port `80`, otherwise `index.js` falls back to port `8080`.

---

### Step 7: Verify Service & Auto-Boot

1. Check that the service is running:
   ```cmd
   sc query IPIS_Display_Config
   ```
   `STATE` should show `RUNNING`.
2. Check startup logs in `logs\service_out.log` to confirm:
   - `[STATUS] Server running on http://0.0.0.0:80`
   - `[NET-IP] Dynamic Resolved Board IP: 10.0.0.31` (or `10.0.0.81` for AVDB)
3. Open a browser on the Mini PC or another PC on the `10.0.0.x` network:
   - **VDB:** `http://10.0.0.31`
   - **AVDB:** `http://10.0.0.81`
4. Log in with your OEM password and verify the **Board Type**, **Platform Number**, and **Active Network IP**.
5. **Reboot the Mini PC** and without logging into Windows, test opening `http://10.0.0.31` (or `http://10.0.0.81`) from another machine to confirm auto-start on boot.

---

## Service Management Commands (Run as Administrator)

Run these commands from `D:\IPIS_Display_Config`:

| Action | Command |
| :--- | :--- |
| Check service status | `.\nssm.exe status IPIS_Display_Config` |
| Start service | `.\nssm.exe start IPIS_Display_Config` |
| Stop service | `.\nssm.exe stop IPIS_Display_Config` |
| Restart service | `.\nssm.exe restart IPIS_Display_Config` |
| Remove service | `.\nssm.exe stop IPIS_Display_Config && .\nssm.exe remove IPIS_Display_Config confirm` |

You can also manage `IPIS_Display_Config` from **Windows Services** (`services.msc`).

---

## Configuration & Environment Details

- **Default Port:** `80` (override with `PORT` environment variable; falls back to `8080` on `EACCES`/`EADDRINUSE`)
- **CDC Master URL:** `http://10.0.0.253:20000` (override with `CDC_URL` environment variable; polls every 30 seconds; falls back to `OFFLINE_FALLBACK` using `data/board_config.json` when CDC is unreachable)
- **IP Switching via Web UI:** Saving a new IP in the web UI notifies the CDC (`POST /api/display-board/update-config`), persists `data/board_config.json`, and runs `netsh interface ipv4 set address name="<adapter>" static <newIp> 255.255.255.0 10.0.0.1` after a 1-second delay.

---

## Troubleshooting

- **Service fails to start or `STATE` is `PAUSED` / `STOPPED`:**
  - Inspect `logs\service_err.log` and `logs\service_out.log`.
  - Verify `C:\Program Files\nodejs\node.exe` exists and `npm install` was run inside `APP_DIR` (`node_modules\` exists).
  - Verify `APP_DIR` in `install_service.bat` matches the actual project folder path.
- **Accessible locally (`http://localhost`), but not from another PC:**
  - Verify Windows Firewall allows TCP port `80` (Step 5) and both PCs are on the `10.0.0.x` subnet.
- **Accessible only on `:8080` instead of `:80`:**
  - Another process (e.g., IIS / `HTTP.sys`) is using port `80`. Check with `netstat -ano | findstr :80` in an Administrator terminal.
- **IP change from Web UI fails with elevation error:**
  - Ensure you run via the Windows Service (`IPIS_Display_Config`) or launch `node index.js` from an Administrator terminal; `netsh` requires Administrator/SYSTEM privileges.
