@echo off
:: Administrator Privilege Check
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] Please run this script as Administrator!
    pause
    exit /b 1
)

set SERVICE_NAME=IPIS_Display_Config
set APP_DIR=D:\IPIS_Display_Config
set LOG_DIR=%APP_DIR%\logs

:: Create logs directory if missing
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

:: Stop and remove previous instance if already registered
"%APP_DIR%\nssm.exe" stop %SERVICE_NAME% >nul 2>&1
"%APP_DIR%\nssm.exe" remove %SERVICE_NAME% confirm >nul 2>&1

echo [INFO] Registering %SERVICE_NAME% as Windows Background Service...

:: Install Node Service via NSSM
"%APP_DIR%\nssm.exe" install %SERVICE_NAME% "C:\Program Files\nodejs\node.exe" "index.js"
"%APP_DIR%\nssm.exe" set %SERVICE_NAME% AppDirectory "%APP_DIR%"

:: Startup & Failure Recovery Configurations
"%APP_DIR%\nssm.exe" set %SERVICE_NAME% Start SERVICE_AUTO_START
"%APP_DIR%\nssm.exe" set %SERVICE_NAME% AppRestartDelay 2000
"%APP_DIR%\nssm.exe" set %SERVICE_NAME% AppExit Default Restart

:: Log routing with auto-rotation (5MB max per log)
"%APP_DIR%\nssm.exe" set %SERVICE_NAME% AppStdout "%LOG_DIR%\service_out.log"
"%APP_DIR%\nssm.exe" set %SERVICE_NAME% AppStderr "%LOG_DIR%\service_err.log"
"%APP_DIR%\nssm.exe" set %SERVICE_NAME% AppRotateFiles 1
"%APP_DIR%\nssm.exe" set %SERVICE_NAME% AppRotateOnline 1
"%APP_DIR%\nssm.exe" set %SERVICE_NAME% AppRotateBytes 5242880

:: Start the newly created service
"%APP_DIR%\nssm.exe" start %SERVICE_NAME%

echo ==========================================================
echo [SUCCESS] %SERVICE_NAME% configured and started successfully!
echo Web diagnostic interface is accessible at port 80.
echo ==========================================================
pause