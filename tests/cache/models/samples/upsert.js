/**
 * Copyright (c) 2017, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or
 * https://opensource.org/licenses/BSD-3-Clause
 */

/**
 * tests/cache/models/samples/upsert.js
 */
'use strict'; // eslint-disable-line strict
const supertest = require('supertest');
const api = supertest(require('../../../../express').app);
const constants = require('../../../../api/v1/constants');
const tu = require('../../../testUtils');
const redisOps = require('../../../../cache/redisOps');
const rtu = require('../redisTestUtil');
const samstoinit = require('../../../../cache/sampleStoreInit');
const sampleStore = require('../../../../cache/sampleStore');
const rcli = require('../../../../cache/redisCache').client.sampleStore;
const u = require('./utils');
const expect = require('chai').expect;
const Aspect = tu.db.Aspect;
const Subject = tu.db.Subject;
const path = '/v1/samples/upsert';

describe('tests/cache/models/samples/upsert.js, ' +
`api::redisEnabled::POST::upsert ${path} >`, () => {
  let aspect;
  let subject;
  let token;
  let userId;
  const URL1 = 'https://samples.com';
  const URL2 = 'https://updatedsamples.com';
  const relatedLinks = [
    { name: 'link1', url: URL1 },
    { name: 'link2', url: URL1 },
  ];
  const updatedRelatedLinks = [
    { name: 'link1', url: URL2 },
    { name: 'link2', url: URL2 },
  ];

  before((done) => {
    tu.toggleOverride('enableRedisSampleStore', true);
    tu.createUserAndToken()
    .then((obj) => {
      userId = obj.user.id;
      token = obj.token;
      done();
    })
    .catch(done);
  });

  beforeEach((done) => {
    Aspect.create(u.aspectToCreate)
    .then((a) => {
      aspect = a;
      return Subject.create(u.subjectToCreate);
    })
    .then((s) => {
      subject = s;
      return samstoinit.eradicate();
    })
    .then(() => samstoinit.init())
    .then(() => done())
    .catch(done);
  });

  afterEach(rtu.forceDelete);
  after(tu.forceDeleteUser);
  after(() => tu.toggleOverride('enableRedisSampleStore', false));

  describe('returns user and profile >', () => {
    it('return user and profile objects', (done) => {
      api.post(path)
      .set('Authorization', token)
      .send({
        name: `${subject.absolutePath}|${aspect.name}`,
        value: '2',
        provider: userId,
      })
      .expect(constants.httpStatus.OK)
      .end((err, res) => {
        if (err) {
          return done(err);
        }

        const { user } = res.body;
        expect(user).to.be.an('object');
        expect(user.name).to.be.an('string');
        expect(user.email).to.be.an('string');
        expect(user.profile).to.be.an('object');
        expect(user.profile.name).to.be.an('string');

        // check aspsubmap for added set
        rcli.smembersAsync(
          'samsto:aspsubmap:' + aspect.name.toLowerCase()
        )
        .then((resCli) => {
          expect(resCli).to.deep.equal([subject.absolutePath.toLowerCase()]);
        })
        .then(() => done())
        .catch(done);
      });
    });
  });

  describe('when subject not present >', () => {
    // unpublish the subjects
    beforeEach((done) => {
      rcli.delAsync(
        sampleStore.toKey(sampleStore.constants.objectType.subject, subject.absolutePath)
      )
      .then(() => done())
      .catch(done);
    });

    it('sample upsert returns not found', (done) => { // subject issue
      api.post(path)
      .set('Authorization', token)
      .send({
        name: `${subject.absolutePath}|${aspect.name}`,
        value: '2',
      })
      .expect(constants.httpStatus.NOT_FOUND)
      .end((err, res) => {
        if (err) {
          return done(err);
        }

        expect(res.body.errors[0].description)
        .to.be.equal('subject for this sample was not found or has ' +
          'isPublished=false');
        done();
      });
    });
  });

  describe('when aspect not present >', () => {
    // unpublish the aspects
    beforeEach((done) => {
      rcli.delAsync(
        sampleStore.toKey(sampleStore.constants.objectType.aspect, aspect.name)
      )
      .then(() => done())
      .catch(done);
    });

    it('sample upsert returns not found', (done) => { // subject issue
      api.post(path)
      .set('Authorization', token)
      .send({
        name: `${subject.absolutePath}|${aspect.name}`,
        value: '2',
      })
      .expect(constants.httpStatus.NOT_FOUND)
      .end((err, res) => {
        if (err) {
          return done(err);
        }

        expect(res.body.errors[0].description)
        .to.be.equal('aspect for this sample was not found or has ' +
          'isPublished=false');
        done();
      });
    });
  });

  describe('unpublished subject >', () => {
    let unPublishedSubjectAbsolutePath;

    // unpublish the subject
    beforeEach((done) => {
      Subject.findByPk(subject.id)
      .then((subjectOne) => subjectOne.update({
        isPublished: false,
      }))
      .then((_subject) => {
        unPublishedSubjectAbsolutePath = _subject.absolutePath;
        done();
      })
      .catch(done);
    });

    it('name refers to unpublished subject', (done) => {
      api.post(path)
      .set('Authorization', token)
      .send({
        name: `${unPublishedSubjectAbsolutePath.absolutePath}|${aspect.name}`,
        value: '2',
      })
      .expect(constants.httpStatus.NOT_FOUND)
      .end((err, res) => {
        if (err) {
          return done(err);
        }

        done();
      });
    });
  });

  describe('unpublished aspect >', () => {
    let updatedAspect;

    // unpublish the aspects
    beforeEach((done) => {
      Aspect.findByPk(aspect.id)
      .then((aspectOne) => aspectOne.update({
        isPublished: false,
      }))
      .then((_aspect) => {
        updatedAspect = _aspect;
        done();
      })
      .catch(done);
    });

    it('name refers to unpublished aspect', (done) => {
      api.post(path)
      .set('Authorization', token)
      .send({
        name: `${subject.absolutePath}|${updatedAspect.name}`,
        value: '2',
      })
      .expect(constants.httpStatus.NOT_FOUND)
      .end(done);
    });
  });

  describe('when sample already exists >', () => {
    beforeEach((done) => {
      const subjKey = sampleStore.toKey(
        sampleStore.constants.objectType.subject, subject.absolutePath
      );
      const sampleKey = sampleStore.toKey(
        sampleStore.constants.objectType.sample,
        `${subject.absolutePath}|${aspect.name}`
      );
      const aspectName = aspect.name;
      rcli.batch([
        ['sadd', subjKey, aspectName],
        ['sadd', sampleStore.constants.indexKey.sample, sampleKey],
        ['hmset', sampleKey, {
          name: `${subject.absolutePath}|${aspect.name}`,
          value: '1',
          aspectId: aspect.id,
          subjectId: subject.id,
          previousStatus: 'Invalid',
          status: 'Invalid',
        },
        ],
      ])
      .execAsync()
      .then(() => done())
      .catch(done);
    });

    it('name should match subject absolutePath, aspect name', (done) => {
      const sampleName = `${subject.absolutePath}|${aspect.name}`;
      api.post(path)
      .set('Authorization', token)
      .send({
        name: sampleName.toLowerCase(),
        value: '2',
      })
      .expect(constants.httpStatus.OK)
      .end((err, res) => {
        if (err) {
          return done(err);
        }

        expect(res.body.name).to.equal(sampleName);
        done();
      });
    });

    it('value is updated', (done) => {
      api.get('/v1/samples?name=' + `${subject.absolutePath}|${aspect.name}`)
      .set('Authorization', token)
      .end((err, res) => {
        if (err) {
          return done(err);
        }

        expect(res.body).to.have.length(1);
        expect(res.body[0].value).to.equal('1');
        api.post(path)
        .set('Authorization', token)
        .send({
          name: `${subject.absolutePath}|${aspect.name}`,
          value: '2',
        })
        .expect(constants.httpStatus.OK)
        .end((err, res) => {
          if (err) {
            return done(err);
          }

          expect(res.body.status).to.equal(constants.statuses.Warning);
          done();
        });
      });
    });

    it('update relatedLinks succeeds', (done) => {
      api.post(path)
      .set('Authorization', token)
      .send({
        name: `${subject.absolutePath}|${aspect.name}`,
        value: '2',
        relatedLinks: updatedRelatedLinks,
      })
      .end((err, res) => {
        if (err) {
          return done(err);
        }

        expect(res.body.relatedLinks).to.have.length(2);
        expect(res.body.relatedLinks).to.deep.equal(updatedRelatedLinks);

        // posting again without related link should still return related link
        api.post(path)
        .set('Authorization', token)
        .send({
          name: `${subject.absolutePath}|${aspect.name}`,
          value: '3',
        })
        .end((err1, res1) => {
          if (err1) {
            return done(err1);
          }

          expect(res1.body.relatedLinks).to.have.length(2);
          expect(res1.body.relatedLinks).to.deep.equal(updatedRelatedLinks);
          done();
        });
      });
    });

    it('sample is not duplicated', (done) => {
      api.post(path)
      .set('Authorization', token)
      .send({
        name: `${subject.absolutePath}|${aspect.name}`,
        value: '2',
      })
      .then(() => {
        api.get('/v1/samples?name=' + `${subject.absolutePath}|${aspect.name}`)
        .set('Authorization', token)
        .end((err, res) => {
          if (err) {
            return done(err);
          }

          expect(res.body).to.have.length(1);
          expect(res.body[0].name)
          .to.equal(`${subject.absolutePath}|${aspect.name}`);
          done();
        });
      });
    });
  });
});
