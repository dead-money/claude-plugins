@echo off
rem Streams one ElevenLabs line to the speakers (Windows). Same contract as
rem speak.sh: a curl config on stdin, AVATAR_FILTER, AVATAR_RING, AVATAR_FFMPEG.
rem Playback is ffplay, which ships with the usual ffmpeg builds.
rem Variables expand with %...% before the line splits at pipes, and the
rem quotes around them keep a filter's commas, semicolons and bars literal.
setlocal
if not defined AVATAR_FFMPEG set "AVATAR_FFMPEG=ffmpeg"
for %%F in ("%AVATAR_FFMPEG%") do set "AVATAR_FFPLAY=%%~dpFffplay"
if "%AVATAR_FFMPEG%"=="ffmpeg" set "AVATAR_FFPLAY=ffplay"
if not defined AVATAR_FILTER set "AVATAR_FILTER=anull"

if defined AVATAR_RING "%AVATAR_FFMPEG%" -hide_banner -loglevel error -f s16le -ar 22050 -ac 1 -i "%AVATAR_RING%" -f wav - | "%AVATAR_FFPLAY%" -hide_banner -nodisp -autoexit -loglevel error -i -

curl -sSf -K - | "%AVATAR_FFMPEG%" -hide_banner -loglevel error -f s16le -ar 22050 -ac 1 -i - -filter_complex "%AVATAR_FILTER%" -f wav - | "%AVATAR_FFPLAY%" -hide_banner -nodisp -autoexit -loglevel error -i -
exit /b %errorlevel%
