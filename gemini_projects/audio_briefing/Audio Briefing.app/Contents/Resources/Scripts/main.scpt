on run
    try
        -- Initial greeting
        say "Good morning. Here is your audio briefing."

        -- Play bundled audio file
        set audioPath to (path to resource folder as string) & "briefing_audio.mp3"
        set posixAudioPath to quoted form of (POSIX path of audioPath)
        do shell script "afplay " & posixAudioPath

        -- Concluding remark
        say "That concludes your briefing. Have a great day."

    on error errMsg number errNum
        log "Error: " & errMsg & " (Error Code: " & errNum & ")"
    end try
end run
