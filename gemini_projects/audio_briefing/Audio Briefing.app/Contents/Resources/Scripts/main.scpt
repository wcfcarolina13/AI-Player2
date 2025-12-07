try
    display dialog "Audio Briefing App Launched!" buttons {"OK", "Cancel"} default button "OK" giving up after 30
on error errMsg number errNum
    display dialog "Error: " & errMsg & " (Error Code: " & errNum & ")"
end try
