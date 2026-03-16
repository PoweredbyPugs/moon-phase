const express = require("express");
const cors = require("cors");
const sweph = require("sweph");
const moment = require("moment-timezone");

const app = express();
app.use(cors());

// .se1 files in /app/ephemeris
sweph.set_ephe_path("ephemeris");
console.log("Ephemeris path set to 'ephemeris'");

// Original /moon-now endpoint - This works accurately
app.get("/moon-now", (req, res) => {
  // 1) Get current local time in Eastern Time
  const localNow = moment.tz("America/New_York");

  // 2) Convert local time to UTC for Swiss Ephemeris
  const yearUTC = localNow.utc().year();
  const monthUTC = localNow.utc().month() + 1; // +1 because month() is 0-based
  const dayUTC = localNow.utc().date();
  const hourUTC =
    localNow.utc().hour() +
    localNow.utc().minute() / 60 +
    localNow.utc().second() / 3600;

  console.log(`Local Eastern time: ${localNow.format()} => UTC: ${yearUTC}-${monthUTC}-${dayUTC} ${hourUTC}`);

  // 3) Calculate the Moon
  const jd = sweph.julday(yearUTC, monthUTC, dayUTC, hourUTC, sweph.constants.SE_GREG_CAL);
  const flags = sweph.constants.SEFLG_SWIEPH;

  const moonResult = sweph.calc(jd, sweph.constants.SE_MOON, flags);
  if (!moonResult || (moonResult.flag !== 0 && moonResult.flag !== 2)) {
    return res.json({ error: moonResult?.error || "Moon calc error" });
  }
  const moonLon = moonResult.data[0]; // ecliptic longitude

  // 4) Calculate the Sun
  const sunResult = sweph.calc(jd, sweph.constants.SE_SUN, flags);
  if (!sunResult || (sunResult.flag !== 0 && sunResult.flag !== 2)) {
    return res.json({ error: sunResult?.error || "Sun calc error" });
  }
  const sunLon = sunResult.data[0];

  // 5) Phase angle = (MoonLon - SunLon) mod 360
  let phaseAngle = (moonLon - sunLon) % 360;
  if (phaseAngle < 0) phaseAngle += 360;

  // Basic 8-phase classification
  let phaseName = "New Moon";
  if (phaseAngle >= 22.5 && phaseAngle < 67.5) {
    phaseName = "Waxing Crescent";
  } else if (phaseAngle >= 67.5 && phaseAngle < 112.5) {
    phaseName = "First Quarter";
  } else if (phaseAngle >= 112.5 && phaseAngle < 157.5) {
    phaseName = "Waxing Gibbous";
  } else if (phaseAngle >= 157.5 && phaseAngle < 202.5) {
    phaseName = "Full Moon";
  } else if (phaseAngle >= 202.5 && phaseAngle < 247.5) {
    phaseName = "Waning Gibbous";
  } else if (phaseAngle >= 247.5 && phaseAngle < 292.5) {
    phaseName = "Last Quarter";
  } else if (phaseAngle >= 292.5 && phaseAngle < 337.5) {
    phaseName = "Waning Crescent";
  }

  // 6) Find zodiac sign and degree within that sign
  const signNames = [
    "Aries", "Taurus", "Gemini", "Cancer",
    "Leo", "Virgo", "Libra", "Scorpio",
    "Sagittarius", "Capricorn", "Aquarius", "Pisces"
  ];
  const signIndex = Math.floor((moonLon % 360) / 30);
  const moonSign = signNames[signIndex];

  // e.g. if moonLon=45.2 => 15.2 Taurus
  const signDegree = (moonLon % 30).toFixed(2);

  // 7) Return JSON
  res.json({
    localEasternTime: localNow.format(), // e.g. "2025-03-05T23:18:00-05:00"
    moonPhase: phaseName,
    moonSign,
    degreeInSign: signDegree
  });
});

// New endpoint for all planetary positions
app.get("/planets-now", (req, res) => {
  try {
    // 1) Get current local time in Eastern Time
    const localNow = moment.tz("America/New_York");

    // 2) Convert local time to UTC for Swiss Ephemeris
    const yearUTC = localNow.utc().year();
    const monthUTC = localNow.utc().month() + 1; // +1 because month() is 0-based
    const dayUTC = localNow.utc().date();
    const hourUTC =
      localNow.utc().hour() +
      localNow.utc().minute() / 60 +
      localNow.utc().second() / 3600;

    console.log(`Local Eastern time: ${localNow.format()} => UTC: ${yearUTC}-${monthUTC}-${dayUTC} ${hourUTC}`);

    // 3) Calculate the Julian Day
    const jd = sweph.julday(yearUTC, monthUTC, dayUTC, hourUTC, sweph.constants.SE_GREG_CAL);
    const flags = sweph.constants.SEFLG_SWIEPH;

    // 4) Define planets to calculate
    const planets = [
      { id: sweph.constants.SE_SUN, name: "Sun" },
      { id: sweph.constants.SE_MOON, name: "Moon" },
      { id: sweph.constants.SE_MERCURY, name: "Mercury" },
      { id: sweph.constants.SE_VENUS, name: "Venus" },
      { id: sweph.constants.SE_MARS, name: "Mars" },
      { id: sweph.constants.SE_JUPITER, name: "Jupiter" },
      { id: sweph.constants.SE_SATURN, name: "Saturn" },
      { id: sweph.constants.SE_URANUS, name: "Uranus" },
      { id: sweph.constants.SE_NEPTUNE, name: "Neptune" },
      { id: sweph.constants.SE_PLUTO, name: "Pluto" }
    ];

    // 5) Define zodiac signs
    const signNames = [
      "Aries", "Taurus", "Gemini", "Cancer",
      "Leo", "Virgo", "Libra", "Scorpio", 
      "Sagittarius", "Capricorn", "Aquarius", "Pisces"
    ];

    // 6) Calculate positions for all planets
    const planetaryPositions = planets.map(planet => {
      const result = sweph.calc(jd, planet.id, flags);
      
      if (!result || (result.flag !== 0 && result.flag !== 2)) {
        console.error(`Error calculating ${planet.name}: ${result?.error || "unknown error"}`);
        return {
          name: planet.name,
          error: result?.error || "Calculation error"
        };
      }
      
      // Get longitude
      const longitude = result.data[0];
      
      // Calculate sign and degree
      const signIndex = Math.floor((longitude % 360) / 30);
      const sign = signNames[signIndex];
      const degreeInSign = (longitude % 30).toFixed(2);
      
      // Check if retrograde (only applicable for planets, not Sun/Moon)
      const isRetrograde = planet.id !== sweph.constants.SE_SUN && 
                          planet.id !== sweph.constants.SE_MOON && 
                          result.data[3] < 0;
      
      return {
        name: planet.name,
        sign,
        degreeInSign,
        isRetrograde
      };
    });

    // 7) Return JSON with all planetary positions
    res.json({
      localEasternTime: localNow.format(),
      planets: planetaryPositions
    });
    
  } catch (error) {
    console.error("Error calculating planetary positions:", error);
    res.status(500).json({
      error: "Failed to calculate planetary positions"
    });
  }
});

// Improved /weekly-major-phase endpoint using the same ephemeris approach
app.get("/weekly-major-phase", (req, res) => {
  try {
    console.log("Finding accurate major moon phase for the week using ephemeris");
    
    // Get current time
    const now = moment.tz("America/New_York");
    
    // Define current week boundaries (Monday to Sunday)
    const currentDay = now.day(); // 0 is Sunday, 1 is Monday, etc.
    const daysToMonday = currentDay === 0 ? 6 : currentDay - 1; // Days back to Monday
    const mondayDate = moment(now).subtract(daysToMonday, 'days').startOf('day');
    const sundayDate = moment(mondayDate).add(6, 'days').endOf('day');
    
    console.log(`Week range: ${mondayDate.format('YYYY-MM-DD')} to ${sundayDate.format('YYYY-MM-DD')}`);
    
    // Get current moon phase info - using the accurate existing method
    const currentPhaseInfo = getMoonPhaseForDate(now);
    console.log(`Current moon: ${currentPhaseInfo.moonPhase} in ${currentPhaseInfo.moonSign} (${currentPhaseInfo.phaseAngle}°)`);
    
    // Check if we're currently in a major phase
    if (isMajorPhase(currentPhaseInfo.moonPhase)) {
      console.log(`Currently in a major phase: ${currentPhaseInfo.moonPhase}`);
      return res.json({
        date: now.format('YYYY-MM-DD HH:mm:ss'),
        moonPhase: currentPhaseInfo.moonPhase,
        moonSign: currentPhaseInfo.moonSign
      });
    }
    
    // Find all major phases in the current week
    const phasesToCheck = [
      { phase: "New Moon", targetAngle: 0 },
      { phase: "First Quarter", targetAngle: 90 },
      { phase: "Full Moon", targetAngle: 180 },
      { phase: "Last Quarter", targetAngle: 270 }
    ];
    
    // We'll check every 6 hours throughout the week for phase changes
    // This gives us enough granularity to detect major phases
    let majorPhasesInWeek = [];
    let datePointer = moment(mondayDate);
    
    // Analysis data for determining closest major phase if none found
    const angleData = [];
    
    while (datePointer.isSameOrBefore(sundayDate)) {
      const phaseInfo = getMoonPhaseForDate(datePointer);
      const phaseAngle = parseFloat(phaseInfo.phaseAngle);
      
      // Store phase angle for analysis
      angleData.push({
        date: datePointer.format('YYYY-MM-DD HH:mm'),
        angle: phaseAngle,
        moonSign: phaseInfo.moonSign
      });
      
      // Check if we're at or very near a major phase
      for (const phaseCheck of phasesToCheck) {
        // Check if we're within 3 degrees of the target angle
        // Also handle the case of New Moon (0/360 degrees)
        let angleDistance;
        if (phaseCheck.targetAngle === 0) {
          angleDistance = Math.min(phaseAngle, 360 - phaseAngle);
        } else {
          angleDistance = Math.abs(phaseAngle - phaseCheck.targetAngle);
        }
        
        if (angleDistance <= 3) { // Within 3 degrees of major phase
          console.log(`Found ${phaseCheck.phase} at ${datePointer.format('YYYY-MM-DD HH:mm')} (angle: ${phaseAngle.toFixed(2)}°)`);
          
          majorPhasesInWeek.push({
            date: datePointer.format('YYYY-MM-DD HH:mm:ss'),
            moonPhase: phaseCheck.phase,
            moonSign: phaseInfo.moonSign,
            distance: angleDistance
          });
        }
      }
      
      // Move to next 6-hour increment
      datePointer.add(6, 'hours');
    }
    
    console.log(`Found ${majorPhasesInWeek.length} major phases in the week`);
    
    // If we found major phases, return the best one
    if (majorPhasesInWeek.length > 0) {
      // First, sort by distance to exact phase
      majorPhasesInWeek.sort((a, b) => a.distance - b.distance);
      
      // Get the most exact phase
      const exactPhase = majorPhasesInWeek[0];
      console.log(`Returning exact major phase: ${exactPhase.moonPhase} in ${exactPhase.moonSign}`);
      
      return res.json({
        date: exactPhase.date,
        moonPhase: exactPhase.moonPhase,
        moonSign: exactPhase.moonSign
      });
    }
    
    // If no exact major phases in the week, find the closest upcoming major phase
    // This approach determines which major phase we're currently progressing toward
    console.log("No exact major phases this week, finding closest upcoming phase");
    
    // Determine the phase we're progressing toward
    // The moon moves ~12 degrees per day, so we need to find which major phase
    // is coming up next based on the current phase angle
    
    // We've been storing phase angles throughout the week
    // Sort by time to get the most recent angle
    angleData.sort((a, b) => moment(b.date).valueOf() - moment(a.date).valueOf());
    
    // Get the most recent angle data
    const latestAngle = angleData[0].angle;
    const latestSign = angleData[0].moonSign;
    const latestDate = angleData[0].date;
    
    console.log(`Latest angle: ${latestAngle.toFixed(2)}° in ${latestSign} at ${latestDate}`);
    
    // Determine which major phase is coming next
    let nextMajorPhase, nextAngle;
    if (latestAngle < 90) {
      nextMajorPhase = "First Quarter";
      nextAngle = 90;
    } else if (latestAngle < 180) {
      nextMajorPhase = "Full Moon";
      nextAngle = 180;
    } else if (latestAngle < 270) {
      nextMajorPhase = "Last Quarter";
      nextAngle = 270;
    } else {
      nextMajorPhase = "New Moon";
      nextAngle = 360; // Will be treated as 0 in the phase calculation
    }
    
    // Estimate when this phase will occur and in what sign
    // The moon moves about 12-13 degrees per day through the zodiac
    // and the phase angle changes at roughly the same rate
    
    // Calculate days until the next major phase
    const degreesToNext = nextAngle - latestAngle;
    const daysToNext = degreesToNext / 12.2; // Approx degrees per day
    
    // Calculate the date of the next major phase
    const nextPhaseDate = moment(latestDate).add(daysToNext, 'days');
    
    // For the sign, we need to estimate how many signs the moon will move through
    // Each sign is 30 degrees, and the moon moves ~12 degrees per day
    
    // Calculate the sign at the next major phase
    const signNames = [
      "Aries", "Taurus", "Gemini", "Cancer",
      "Leo", "Virgo", "Libra", "Scorpio",
      "Sagittarius", "Capricorn", "Aquarius", "Pisces"
    ];
    
    let signIndex = signNames.indexOf(latestSign);
    const daysPerSign = 30 / 12.2; // Approx days to move through one sign
    const signsToMove = Math.floor(daysToNext / daysPerSign);
    
    // Calculate new sign index
    signIndex = (signIndex + signsToMove) % 12;
    const nextPhaseSign = signNames[signIndex];
    
    console.log(`Next major phase: ${nextMajorPhase} estimated at ${nextPhaseDate.format('YYYY-MM-DD HH:mm')} in ${nextPhaseSign}`);
    
    // Return the next major phase information
    return res.json({
      date: nextPhaseDate.format('YYYY-MM-DD HH:mm:ss'),
      moonPhase: nextMajorPhase,
      moonSign: nextPhaseSign
    });
    
  } catch (error) {
    console.error("Error finding weekly major phase:", error);
    
    // Fallback to a safe response based on current phase
    try {
      const now = moment.tz("America/New_York");
      const currentPhase = getMoonPhaseForDate(now);
      
      // Convert the current phase to the nearest major phase
      const phaseAngle = parseFloat(currentPhase.phaseAngle);
      let majorPhase;
      
      if (phaseAngle < 45 || phaseAngle >= 315) {
        majorPhase = "New Moon";
      } else if (phaseAngle >= 45 && phaseAngle < 135) {
        majorPhase = "First Quarter";
      } else if (phaseAngle >= 135 && phaseAngle < 225) {
        majorPhase = "Full Moon";
      } else {
        majorPhase = "Last Quarter";
      }
      
      return res.json({
        date: now.format('YYYY-MM-DD HH:mm:ss'),
        moonPhase: majorPhase,
        moonSign: currentPhase.moonSign
      });
    } catch (e) {
      console.error("Fallback error:", e);
      return res.json({
        error: "Could not determine moon phase"
      });
    }
  }
});

// Function to get moon phase information for a given date
function getMoonPhaseForDate(dateTime) {
  // Convert to UTC for Swiss Ephemeris calculations
  const yearUTC = dateTime.utc().year();
  const monthUTC = dateTime.utc().month() + 1; // +1 because month() is 0-based
  const dayUTC = dateTime.utc().date();
  const hourUTC =
    dateTime.utc().hour() +
    dateTime.utc().minute() / 60 +
    dateTime.utc().second() / 3600;
  
  // Calculate Julian day
  const jd = sweph.julday(yearUTC, monthUTC, dayUTC, hourUTC, sweph.constants.SE_GREG_CAL);
  const flags = sweph.constants.SEFLG_SWIEPH;
  
  // Calculate Moon position
  const moonResult = sweph.calc(jd, sweph.constants.SE_MOON, flags);
  if (!moonResult || (moonResult.flag !== 0 && moonResult.flag !== 2)) {
    throw new Error(moonResult?.error || "Moon calc error");
  }
  const moonLon = moonResult.data[0]; // ecliptic longitude
  
  // Calculate Sun position
  const sunResult = sweph.calc(jd, sweph.constants.SE_SUN, flags);
  if (!sunResult || (sunResult.flag !== 0 && sunResult.flag !== 2)) {
    throw new Error(sunResult?.error || "Sun calc error");
  }
  const sunLon = sunResult.data[0];
  
  // Calculate phase angle
  let phaseAngle = (moonLon - sunLon) % 360;
  if (phaseAngle < 0) phaseAngle += 360;
  
  // Determine phase name - using the same logic as moon-now
  let phaseName = "New Moon";
  if (phaseAngle >= 22.5 && phaseAngle < 67.5) {
    phaseName = "Waxing Crescent";
  } else if (phaseAngle >= 67.5 && phaseAngle < 112.5) {
    phaseName = "First Quarter";
  } else if (phaseAngle >= 112.5 && phaseAngle < 157.5) {
    phaseName = "Waxing Gibbous";
  } else if (phaseAngle >= 157.5 && phaseAngle < 202.5) {
    phaseName = "Full Moon";
  } else if (phaseAngle >= 202.5 && phaseAngle < 247.5) {
    phaseName = "Waning Gibbous";
  } else if (phaseAngle >= 247.5 && phaseAngle < 292.5) {
    phaseName = "Last Quarter";
  } else if (phaseAngle >= 292.5 && phaseAngle < 337.5) {
    phaseName = "Waning Crescent";
  }
  
  // Calculate zodiac sign
  const signNames = [
    "Aries", "Taurus", "Gemini", "Cancer",
    "Leo", "Virgo", "Libra", "Scorpio",
    "Sagittarius", "Capricorn", "Aquarius", "Pisces"
  ];
  const signIndex = Math.floor((moonLon % 360) / 30);
  const moonSign = signNames[signIndex];
  
  // Calculate degree in sign
  const signDegree = (moonLon % 30).toFixed(2);
  
  return {
    moonPhase: phaseName,
    moonSign,
    degreeInSign: signDegree,
    phaseAngle: phaseAngle.toFixed(2)
  };
}

// Helper to check if a phase is a major phase
function isMajorPhase(phaseName) {
  return ["New Moon", "Full Moon", "First Quarter", "Last Quarter"].includes(phaseName);
}

// Add a simple test endpoint to verify server is running
app.get("/test", (req, res) => {
  res.json({ status: "Server is running correctly" });
});

// Listen on all network interfaces (0.0.0.0) instead of just localhost
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Sweph service listening on port ${PORT} on all interfaces`);
  console.log(`Test the server at: http://localhost:${PORT}/test`);
});

// Add this new endpoint to your server.js file

// New endpoint for planetary aspects
app.get("/aspects-now", (req, res) => {
    try {
      // 1) Get current local time in Eastern Time
      const localNow = moment.tz("America/New_York");
  
      // 2) Convert local time to UTC for Swiss Ephemeris
      const yearUTC = localNow.utc().year();
      const monthUTC = localNow.utc().month() + 1; // +1 because month() is 0-based
      const dayUTC = localNow.utc().date();
      const hourUTC =
        localNow.utc().hour() +
        localNow.utc().minute() / 60 +
        localNow.utc().second() / 3600;
  
      // 3) Calculate the Julian Day
      const jd = sweph.julday(yearUTC, monthUTC, dayUTC, hourUTC, sweph.constants.SE_GREG_CAL);
      const flags = sweph.constants.SEFLG_SWIEPH;
  
      // 4) Define planets to calculate
      const planets = [
        { id: sweph.constants.SE_SUN, name: "Sun" },
        { id: sweph.constants.SE_MOON, name: "Moon" },
        { id: sweph.constants.SE_MERCURY, name: "Mercury" },
        { id: sweph.constants.SE_VENUS, name: "Venus" },
        { id: sweph.constants.SE_MARS, name: "Mars" },
        { id: sweph.constants.SE_JUPITER, name: "Jupiter" },
        { id: sweph.constants.SE_SATURN, name: "Saturn" },
        { id: sweph.constants.SE_URANUS, name: "Uranus" },
        { id: sweph.constants.SE_NEPTUNE, name: "Neptune" },
        { id: sweph.constants.SE_PLUTO, name: "Pluto" }
      ];
  
      // 5) Define zodiac signs (for reference)
      const signNames = [
        "Aries", "Taurus", "Gemini", "Cancer",
        "Leo", "Virgo", "Libra", "Scorpio", 
        "Sagittarius", "Capricorn", "Aquarius", "Pisces"
      ];
  
      // 6) Define aspects with their angles and orbs
      const aspectTypes = [
        { name: "Conjunction", symbol: "☌", angle: 0, orb: 8 },
        { name: "Sextile", symbol: "⚹", angle: 60, orb: 6 },
        { name: "Square", symbol: "□", angle: 90, orb: 8 },
        { name: "Trine", symbol: "△", angle: 120, orb: 8 },
        { name: "Opposition", symbol: "☍", angle: 180, orb: 10 },
        { name: "Quincunx", symbol: "⚻", angle: 150, orb: 3 },
        { name: "Semi-sextile", symbol: "⚺", angle: 30, orb: 3 },
        { name: "Semi-square", symbol: "⚼", angle: 45, orb: 3 },
        { name: "Sesquiquadrate", symbol: "⚿", angle: 135, orb: 3 },
        { name: "Quintile", symbol: "Q", angle: 72, orb: 2 } // Unicode alternatives: ⊥ or ⊻
      ];
  
      // 7) Calculate positions for all planets
      const planetaryPositions = [];
      
      for (const planet of planets) {
        const result = sweph.calc(jd, planet.id, flags);
        
        if (!result || (result.flag !== 0 && result.flag !== 2)) {
          console.error(`Error calculating ${planet.name}: ${result?.error || "unknown error"}`);
          continue;
        }
        
        // Get longitude
        const longitude = result.data[0];
        
        // Calculate sign and degree
        const signIndex = Math.floor((longitude % 360) / 30);
        const sign = signNames[signIndex];
        const degreeInSign = (longitude % 30).toFixed(2);
        
        // Check if retrograde (only applicable for planets, not Sun/Moon)
        const isRetrograde = planet.id !== sweph.constants.SE_SUN && 
                            planet.id !== sweph.constants.SE_MOON && 
                            result.data[3] < 0;
        
        planetaryPositions.push({
          name: planet.name,
          longitude,
          sign,
          degreeInSign,
          isRetrograde
        });
      }
  
      // 8) Calculate aspects between all planets
      const aspects = [];
      
      for (let i = 0; i < planetaryPositions.length; i++) {
        for (let j = i + 1; j < planetaryPositions.length; j++) {
          const planet1 = planetaryPositions[i];
          const planet2 = planetaryPositions[j];
          
          // Calculate angle between planets (smallest angle)
          let angle = Math.abs(planet1.longitude - planet2.longitude) % 360;
          if (angle > 180) angle = 360 - angle;
          
          // Check if this angle corresponds to a known aspect
          for (const aspectType of aspectTypes) {
            const difference = Math.abs(angle - aspectType.angle);
            
            if (difference <= aspectType.orb) {
              // This is a valid aspect
              aspects.push({
                planet1: planet1.name,
                planet2: planet2.name,
                aspectName: aspectType.name,
                aspectSymbol: aspectType.symbol,
                exactAngle: angle.toFixed(2),
                orb: difference.toFixed(2),
                planet1Sign: planet1.sign,
                planet2Sign: planet2.sign,
                planet1Retrograde: planet1.isRetrograde,
                planet2Retrograde: planet2.isRetrograde
              });
              break; // Only count the most precise aspect between two planets
            }
          }
        }
      }
  
      // 9) Return JSON with all aspects
      res.json({
        localEasternTime: localNow.format(),
        aspects
      });
      
    } catch (error) {
      console.error("Error calculating planetary aspects:", error);
      res.status(500).json({
        error: "Failed to calculate planetary aspects"
      });
    }
  });
  
  // Helper function to get aspect symbol
  function getAspectSymbol(aspectName) {
    const aspectSymbols = {
      "Conjunction": "☌",
      "Opposition": "☍",
      "Trine": "△",
      "Square": "□", 
      "Sextile": "⚹",
      "Quincunx": "⚻",
      "Semi-sextile": "⚺",
      "Semi-square": "⚼",
      "Sesquiquadrate": "⚿"
    };
    
    return aspectSymbols[aspectName] || aspectName;
  }