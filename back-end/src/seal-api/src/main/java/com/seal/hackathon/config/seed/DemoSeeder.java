package com.seal.hackathon.config.seed;

import com.seal.hackathon.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import java.util.Set;

/**
 * Optional demo-data seeder, gated by {@code app.seed.scenario}. Runs AFTER the
 * essential {@code DataSeeder} (roles/admin) via {@link Order}. Idempotent by guard:
 * if the demo accounts already exist it does nothing — drop the DB to reseed a
 * different scenario. Default {@code NONE} → never seeds fake data (safe for prod/EC2).
 */
@Component
@Order(2)
@RequiredArgsConstructor
public class DemoSeeder implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(DemoSeeder.class);
    private static final Set<String> VALID = Set.of("NONE", "S1", "S25", "S3", "ALL", "MULTI");

    @Value("${app.seed.scenario:NONE}")
    private String scenario;

    private final UserRepository userRepo;
    private final DemoScenario demoScenario;

    @Override
    public void run(String... args) {
        String s = scenario == null ? "NONE" : scenario.trim().toUpperCase();
        if (!VALID.contains(s)) {
            log.warn("[demo] unknown app.seed.scenario='{}' — skipping (expected {})", scenario, VALID);
            return;
        }
        if ("NONE".equals(s) || "ALL".equals(s) || "MULTI".equals(s)) {
            return;
        }
        if (userRepo.existsByEmail(DemoScenario.COORDINATOR_EMAIL)) {
            log.info("[demo] scenario {} requested but demo data already exists — skipping (drop the DB to reseed).", s);
            return;
        }
        log.info("[demo] seeding scenario {} …", s);
        demoScenario.seed(s);
    }
}
